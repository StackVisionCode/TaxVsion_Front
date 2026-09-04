import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, map, switchMap } from 'rxjs';
import { ToastService } from '@shared/ui/toast/toast.service';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { InitiateUploadRequest } from '@core/cloud-storage/cloud-storage.model';
import { CallsService } from './calls.service';
import { CallRecordingService } from './call-recording.service';
import { CallConnectionQuality, CallKind, CallRecordingState, CallStatus, IceServer } from './call.model';

/** Cada cuánto muestreo pc.getStats() para estimar la calidad de conexión. */
const STATS_POLL_MS = 4000;

export type ActiveCallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

/**
 * Estado + señalización WebRTC de la llamada 1:1 activa (mesh). Un solo
 * RTCPeerConnection a la vez. Perfect-negotiation: el callee es "polite" (cede en
 * colisión de ofertas), el caller "impolite" (lo confirma `call.peer_joined.isPolite`).
 * Singleton — el overlay global (montado en el shell) solo LEE estos signals; toda la
 * señalización vive acá para recibir/atender llamadas en cualquier página.
 *
 * Adaptado del Portal con dos endurecimientos: se bufferean los candidatos ICE que
 * llegan antes del remote description, y si falla getUserMedia se aborta la llamada
 * con un aviso claro (en el Portal seguía sin micrófono, en silencio).
 */
@Injectable({ providedIn: 'root' })
export class ActiveCallService {
  private readonly calls = inject(CallsService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly recording = inject(CallRecordingService);
  private readonly cloudStorage = inject(CloudStorageUploadService);

  readonly phase = signal<ActiveCallPhase>('idle');
  readonly callId = signal<string | null>(null);
  readonly kind = signal<CallKind>('Audio');
  readonly peerUserId = signal<string | null>(null);
  readonly peerDisplayName = signal<string | null>(null);
  readonly conversationId = signal<string | null>(null);

  readonly localStream = signal<MediaStream | null>(null);
  readonly remoteStream = signal<MediaStream | null>(null);
  readonly audioEnabled = signal(true);
  readonly videoEnabled = signal(true);
  readonly remoteAudioEnabled = signal(true);
  /** Estoy compartiendo mi pantalla. */
  readonly screenSharing = signal(false);
  /** El par está enviando video (cámara o pantalla) — para mostrar el stage / placeholder. */
  readonly peerVideoActive = signal(false);
  /** Calidad de conexión local estimada (getStats). Solo se muestra la propia — no hay evento de bajada del par. */
  readonly connectionQuality = signal<CallConnectionQuality>('Good');
  /** ICE cayó y está intentando reconectar (estado transitorio, puede recuperarse). */
  readonly reconnecting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  // ---------- Grabación ----------
  readonly recordingState = signal<CallRecordingState>('Idle');
  /** Tiempo transcurrido de la grabación en curso (ms) para mostrar "REC 0:12" junto al badge. */
  readonly recordingElapsedMs = signal(0);
  readonly recordingElapsedLabel = computed(() => {
    const s = Math.floor(this.recordingElapsedMs() / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
  private recordingTimer: ReturnType<typeof setInterval> | null = null;
  private recordingStartedAt = 0;
  /** userId del que pidió grabar cuando ME toca responder el consentimiento (null = sin prompt). */
  readonly recordingConsentFrom = signal<string | null>(null);
  private readonly _recordingRequesterId = signal<string | null>(null);
  /** Soy el que pidió grabar (el que captura con MediaRecorder y sube el archivo). */
  readonly isRecordingRequester = computed(
    () => !!this._recordingRequesterId() && this._recordingRequesterId() === (this.auth.currentUser()?.id ?? null),
  );

  private pc: RTCPeerConnection | null = null;
  /**
   * Latch del armado de la PeerConnection. `ensurePeerConnection` se dispara desde varios eventos
   * casi simultáneos (peer_joined, state_changed 'Accepted', accept/startCall) y tiene awaits (ICE +
   * getUserMedia); sin un latch, dos disparos crean DOS PeerConnection (media a medio negociar), y una
   * oferta que llega en ese hueco arma la answer SIN pistas locales (recvonly → audio en un solo
   * sentido). Todos comparten esta promesa y esperan el MISMO armado.
   */
  private pcReady: Promise<void> | null = null;
  private isPolite = false;
  /**
   * Solo el que INICIA la llamada crea la oferta. Ambos peers agregan pistas en `buildPeerConnection`
   * → ambos disparaban `onnegotiationneeded` → el callee creaba su propia oferta y, al llegar la del
   * caller, hacía un rollback que reordenaba los m-lines ("m-lines in answer don't match order in offer").
   * Como el upgrade a video / screen-share usan `replaceTrack` (sin renegociar), el callee NUNCA necesita
   * ofertar: solo responde. Se basa en quién inició (no en `isPolite`, que lo reasigna el server).
   */
  private isCaller = false;
  private makingOffer = false;
  private ignoreOffer = false;
  private listenersBound = false;
  /** Candidatos ICE llegados antes de tener remote description — se aplican al setearlo. */
  private pendingCandidates: RTCIceCandidateInit[] = [];
  /**
   * Emisor de video (sender). Se crea SIEMPRE al armar la conexión (con track en video,
   * o como transceiver `sendrecv` vacío en audio). Así "upgrade to video" y screen share
   * cambian el track con `replaceTrack` — sin renegociar, sin glare (el m-line ya existe).
   */
  private videoSender: RTCRtpSender | null = null;
  /** Track de cámara (para restaurar tras compartir pantalla). */
  private cameraTrack: MediaStreamTrack | null = null;
  /** Track de pantalla activo mientras se comparte. */
  private screenTrack: MediaStreamTrack | null = null;
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private lastReportedQuality: CallConnectionQuality | null = null;
  private prevPacketsLost = 0;
  private prevPacketsReceived = 0;

  /** Se llama UNA vez al conectar el socket (desde el shell) para escuchar llamadas en cualquier página. */
  bindGlobalListeners(): void {
    if (this.listenersBound) {
      return;
    }
    this.listenersBound = true;

    this.calls.onIncoming().subscribe(dto => {
      if (this.phase() !== 'idle') {
        return; // ya hay una llamada; el server rechaza la 2da, esto es defensa extra.
      }
      this.errorMessage.set(null);
      this.callId.set(dto.callId);
      this.kind.set(dto.kind);
      this.videoEnabled.set(dto.kind === 'Video'); // audio entrante = sin video propio
      this.peerUserId.set(dto.callerUserId);
      this.peerDisplayName.set(dto.callerDisplayName);
      this.conversationId.set(dto.conversationId);
      this.isPolite = true; // el callee es polite
      this.isCaller = false; // el callee responde, no oferta
      this.phase.set('incoming');
    });

    this.calls.onStateChanged().subscribe(dto => {
      if (dto.callId !== this.callId()) {
        return;
      }
      void this.handleStateChanged(dto.status);
    });

    this.calls.onPeerJoined().subscribe(dto => {
      if (dto.callId !== this.callId()) {
        return;
      }
      this.isPolite = dto.isPolite;
      void this.ensurePeerConnection();
    });

    this.calls.onSignalFrom().subscribe(dto => {
      if (dto.callId !== this.callId()) {
        return;
      }
      void this.handleSignal(dto.kind, dto.data);
    });

    this.calls.onMediaStatusChanged().subscribe(dto => {
      if (dto.callId !== this.callId()) {
        return;
      }
      this.remoteAudioEnabled.set(dto.audioEnabled);
      // El par envía video si tiene cámara encendida o comparte pantalla — para stage/placeholder.
      this.peerVideoActive.set(dto.videoEnabled || dto.screenSharing);
    });

    this.calls.onUpgradedToVideo().subscribe(dto => {
      if (dto.callId !== this.callId()) {
        return;
      }
      // El par pasó la llamada a video: cambiamos la UI a video. Su track ya fluye por el
      // transceiver pre-creado (no hace falta renegociar). Si el upgrade fue nuestro, ya está en Video.
      if (this.kind() !== 'Video') {
        this.kind.set('Video');
      }
    });

    // ----- Grabación (consentimiento + estado) -----
    this.calls.onRecordingConsentRequested().subscribe(dto => {
      if (dto.callId !== this.callId()) {
        return;
      }
      this._recordingRequesterId.set(dto.requestedByUserId);
      this.recordingState.set('Requesting');
      if (dto.requestedByUserId === (this.auth.currentUser()?.id ?? null)) {
        // Soy el que pidió grabar: consiento automáticamente (no me muestro modal a mí mismo).
        void this.calls.respondRecordingConsent(dto.callId, 'Accepted').catch(() => undefined);
      } else {
        // El otro pidió grabar: pido consentimiento explícito (modal global).
        this.recordingConsentFrom.set(dto.requestedByUserId);
      }
    });

    this.calls.onRecordingConsentRecorded().subscribe(dto => {
      if (dto.callId !== this.callId()) {
        return;
      }
      if (dto.response === 'Rejected') {
        // Con AllAccepted, un rechazo impide arrancar: se cierra el ciclo.
        this.toast.info('Recording was declined.');
        this.recordingState.set('Idle');
        this._recordingRequesterId.set(null);
        this.recordingConsentFrom.set(null);
      }
    });

    this.calls.onRecordingStateChanged().subscribe(dto => {
      if (dto.callId !== this.callId()) {
        return;
      }
      this.recordingState.set(dto.state);
      if (dto.state === 'Recording') {
        this.startRecordingTimer();
        if (this.isRecordingRequester()) {
          this.recording.start(this.localStream(), this.remoteStream());
        }
      } else {
        this.stopRecordingTimer();
        if (dto.state === 'Failed') {
          this.toast.error('The recording failed.');
        }
      }
    });

    this.calls.onTranscriptReady().subscribe(dto => {
      if (dto.callId !== this.callId()) {
        return;
      }
      this.toast.success('The call transcript is ready.');
    });
  }

  async startCall(peerUserId: string, peerDisplayName: string, kind: CallKind, conversationId?: string): Promise<void> {
    if (this.phase() !== 'idle') {
      return;
    }
    this.errorMessage.set(null);
    this.peerUserId.set(peerUserId);
    this.peerDisplayName.set(peerDisplayName);
    this.kind.set(kind);
    this.conversationId.set(conversationId ?? null);
    this.audioEnabled.set(true);
    this.videoEnabled.set(kind === 'Video');
    this.isPolite = false; // el caller es impolite
    this.isCaller = true; // el caller crea la ÚNICA oferta
    this.phase.set('outgoing');

    try {
      const { callId } = await this.calls.initiate(peerUserId, kind, conversationId);
      this.callId.set(callId);
    } catch {
      this.toast.error('Could not start the call.');
      this.reset();
    }
  }

  async acceptIncoming(): Promise<void> {
    const callId = this.callId();
    if (!callId) {
      return;
    }
    this.phase.set('connecting');
    try {
      await this.calls.accept(callId);
      await this.ensurePeerConnection();
    } catch {
      this.toast.error('Could not accept the call.');
      void this.endCall();
    }
  }

  async rejectIncoming(): Promise<void> {
    const callId = this.callId();
    if (callId) {
      try {
        await this.calls.reject(callId);
      } catch {
        /* noop */
      }
    }
    this.reset();
  }

  async endCall(): Promise<void> {
    const callId = this.callId();
    // Si estoy grabando, capturo el blob ANTES de cortar los tracks (la subida va en background).
    let pendingBlob: Blob | null = null;
    if (this.isRecordingRequester() && this.recordingState() === 'Recording') {
      if (callId) {
        try {
          await this.calls.stopRecording(callId);
        } catch {
          /* noop */
        }
      }
      pendingBlob = await this.recording.stop();
    }
    if (callId) {
      try {
        await this.calls.end(callId);
      } catch {
        /* noop */
      }
    }
    if (pendingBlob && callId) {
      void this.uploadAndAttach(callId, pendingBlob);
    }
    this.reset();
  }

  toggleAudio(): void {
    const enabled = !this.audioEnabled();
    this.audioEnabled.set(enabled);
    this.localStream()
      ?.getAudioTracks()
      .forEach(t => (t.enabled = enabled));
    this.publishMediaStatus();
  }

  toggleVideo(): void {
    const enabled = !this.videoEnabled();
    this.videoEnabled.set(enabled);
    this.localStream()
      ?.getVideoTracks()
      .forEach(t => (t.enabled = enabled));
    this.publishMediaStatus();
  }

  /**
   * Pasa una llamada de audio ACTIVA a video encendiendo la cámara. No renegocia: hace
   * `replaceTrack` sobre el sender de video pre-creado en ensurePeerConnection (glare-free).
   */
  async upgradeToVideo(): Promise<void> {
    const callId = this.callId();
    if (!callId || this.kind() !== 'Audio' || this.phase() !== 'active' || !this.pc) {
      return;
    }
    let camStream: MediaStream;
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch {
      this.toast.error('Allow camera access to turn on video.');
      return;
    }
    const videoTrack = camStream.getVideoTracks()[0];
    if (!videoTrack) {
      return;
    }
    this.cameraTrack = videoTrack;
    if (this.videoSender) {
      await this.videoSender.replaceTrack(videoTrack); // sin renegociación
    } else {
      // Fallback (no debería pasar: siempre pre-creamos el sender). addTrack SÍ renegocia.
      this.videoSender = this.pc.addTrack(videoTrack, this.localStream() ?? new MediaStream([videoTrack]));
    }
    this.localStream()?.addTrack(videoTrack); // el PiP local (bind al mismo stream) lo toma en vivo
    this.kind.set('Video');
    this.videoEnabled.set(true);
    try {
      await this.calls.upgradeToVideo(callId);
    } catch {
      // El media ya fluye y la UI local ya cambió; el evento al par es best-effort.
    }
    this.publishMediaStatus();
  }

  /** Compartir pantalla: getDisplayMedia → replaceTrack sobre el videoSender (sin renegociar). */
  async startScreenShare(callId = this.callId()): Promise<void> {
    if (!callId || this.phase() !== 'active' || this.screenSharing() || !this.videoSender) {
      return;
    }
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch {
      return; // el usuario canceló el selector de pantalla; sin ruido
    }
    const track = display.getVideoTracks()[0];
    if (!track) {
      return;
    }
    this.screenTrack = track;
    await this.videoSender.replaceTrack(track);
    this.swapLocalVideoTrack(track);
    // El navegador tiene su propio botón "Dejar de compartir": engancharlo para parar limpio.
    track.onended = () => void this.stopScreenShare();
    this.screenSharing.set(true);
    try {
      await this.calls.startScreenShare(callId);
    } catch {
      /* el media ya fluye; la señal es best-effort */
    }
    this.publishMediaStatus();
  }

  async stopScreenShare(callId = this.callId()): Promise<void> {
    if (!this.screenSharing()) {
      return;
    }
    this.screenTrack?.stop();
    this.screenTrack = null;
    // Volver a la cámara si la había; si era llamada de audio, dejar el sender sin track.
    await this.videoSender?.replaceTrack(this.cameraTrack ?? null);
    this.swapLocalVideoTrack(this.cameraTrack ?? null);
    this.screenSharing.set(false);
    if (callId) {
      try {
        await this.calls.stopScreenShare(callId);
      } catch {
        /* noop */
      }
    }
    this.publishMediaStatus();
  }

  /** Deja en el localStream (preview) solo el track de video indicado (cámara o pantalla), o ninguno. */
  private swapLocalVideoTrack(track: MediaStreamTrack | null): void {
    const stream = this.localStream();
    if (!stream) {
      return;
    }
    stream.getVideoTracks().forEach(t => {
      if (t !== track) {
        stream.removeTrack(t); // removeTrack NO detiene el track (la cámara sigue viva para restaurar)
      }
    });
    if (track && !stream.getVideoTracks().includes(track)) {
      stream.addTrack(track);
    }
  }

  // ---------- Grabación (con consentimiento) ----------

  /** Pide grabar: abre el ciclo de consentimiento (no arranca aún). Cualquiera de los 2 puede pedirlo. */
  async requestRecording(): Promise<void> {
    const callId = this.callId();
    if (!callId || this.phase() !== 'active' || this.recordingState() !== 'Idle') {
      return;
    }
    try {
      await this.calls.requestRecording(callId);
    } catch {
      this.toast.error('Could not start recording.');
    }
  }

  /** Responde el modal de consentimiento (solo lo ve quien NO pidió grabar). */
  async respondRecordingConsent(accepted: boolean): Promise<void> {
    const callId = this.callId();
    this.recordingConsentFrom.set(null);
    if (!callId) {
      return;
    }
    try {
      await this.calls.respondRecordingConsent(callId, accepted ? 'Accepted' : 'Rejected');
    } catch {
      /* noop */
    }
  }

  /** Para la grabación (solo el requester): avisa al server, captura el blob y lo sube. */
  async stopRecording(): Promise<void> {
    const callId = this.callId();
    if (!callId || !this.isRecordingRequester() || this.recordingState() !== 'Recording') {
      return;
    }
    try {
      await this.calls.stopRecording(callId);
    } catch {
      /* noop */
    }
    const blob = await this.recording.stop();
    if (blob) {
      void this.uploadAndAttach(callId, blob);
    }
  }

  /** Si terminó la llamada mientras grababa (fin abrupto), captura lo grabado y lo sube igual. */
  private finalizeRecordingBackground(): void {
    if (!this.isRecordingRequester()) {
      return;
    }
    const callId = this.callId();
    if (!callId) {
      return;
    }
    void this.recording.stop().then(blob => {
      if (blob && blob.size > 0) {
        void this.uploadAndAttach(callId, blob);
      }
    });
  }

  /** Sube el archivo a CloudStorage (initiate→MinIO→complete) y lo adjunta a la grabación. */
  private async uploadAndAttach(callId: string, blob: Blob): Promise<void> {
    if (blob.size === 0) {
      return;
    }
    const file = new File([blob], `call-recording-${callId}.webm`, { type: 'audio/webm' });
    const request: InitiateUploadRequest = {
      originalName: file.name,
      contentType: 'audio/webm',
      sizeBytes: file.size,
      ownerType: 'Communication',
      ownerId: callId,
      // La grabación (audio mezclado, audio/webm) va a la carpeta Recordings — OtherPolicy no admite
      // audio/* y devolvía 400 ("Could not save the recording"). RecordingsPolicy acepta audio/webm.
      folderType: 'Recordings',
      taxYear: null,
    };
    // Paso 1: subir a CloudStorage. Si esto falla, la grabación de verdad se perdió → toast de error.
    let fileId: string;
    try {
      fileId = await firstValueFrom(
        this.cloudStorage.initiateUpload(request).pipe(
          switchMap(init =>
            this.cloudStorage.uploadToPresignedUrl(init.uploadUrl, init.formData, file).pipe(
              switchMap(() => this.cloudStorage.completeUpload(init.fileId)),
              map(() => init.fileId),
            ),
          ),
        ),
      );
    } catch {
      this.toast.error('Could not save the recording.');
      return;
    }
    // Paso 2: enlazar el fileId a la llamada por socket. El archivo YA está guardado; este attach puede
    // perder la carrera con el fin de la llamada. Es idempotente (mismo fileId) → un reintento; si aun así
    // falla NO se muestra error (la grabación existe en CloudStorage, solo faltó el vínculo).
    try {
      await this.calls.attachRecording(callId, fileId);
    } catch {
      try {
        await this.calls.attachRecording(callId, fileId);
      } catch {
        /* la grabación quedó guardada; el vínculo se puede reconciliar aparte. Sin toast de error. */
      }
    }
  }

  private publishMediaStatus(): void {
    const callId = this.callId();
    if (!callId) {
      return;
    }
    this.calls.mediaStatus(callId, this.audioEnabled(), this.videoEnabled(), this.screenSharing());
  }

  private async handleStateChanged(status: CallStatus): Promise<void> {
    if (status === 'Accepted') {
      this.phase.set('connecting');
      await this.ensurePeerConnection();
    } else if (status === 'Active') {
      this.phase.set('active');
    } else if (
      status === 'Ended' ||
      status === 'Rejected' ||
      status === 'Cancelled' ||
      status === 'MissedCall' ||
      status === 'Failed'
    ) {
      this.reset();
    }
  }

  /** Arma la PeerConnection UNA sola vez por llamada; disparos concurrentes esperan el mismo armado. */
  private ensurePeerConnection(): Promise<void> {
    if (!this.pcReady) {
      this.pcReady = this.buildPeerConnection().catch(err => {
        this.pcReady = null; // permite reintentar tras un fallo de armado
        throw err;
      });
    }
    return this.pcReady;
  }

  private async buildPeerConnection(): Promise<void> {
    if (this.pc) {
      return;
    }

    let iceServers: IceServer[] = [];
    try {
      const ice = await firstValueFrom(this.calls.getIceServers());
      iceServers = ice.iceServers;
    } catch {
      // Degradación consciente: STUN público si /webrtc/ice falla (puede no atravesar NAT sin TURN).
      iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }

    const pc = new RTCPeerConnection({ iceServers: iceServers as RTCIceServer[] });
    this.pc = pc;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: this.kind() === 'Video' });
    } catch {
      // Sin permiso de micro/cámara no hay llamada: abortar con aviso claro (a diferencia del Portal).
      this.errorMessage.set('Could not access your microphone/camera.');
      this.toast.error(
        this.kind() === 'Video'
          ? 'Allow camera and microphone access to start the call.'
          : 'Allow microphone access to start the call.',
      );
      void this.endCall();
      return;
    }
    this.localStream.set(stream);
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    // Pre-crear el m-line de video para poder pasar a video/screenshare con replaceTrack (sin renegociar).
    // Ambos lados lo hacen para que las líneas SDP calcen. En una llamada de video ya hay sender de video.
    if (this.kind() === 'Video') {
      this.videoSender = pc.getSenders().find(s => s.track?.kind === 'video') ?? null;
      this.cameraTrack = stream.getVideoTracks()[0] ?? null;
    } else {
      this.videoSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
    }

    const remote = new MediaStream();
    this.remoteStream.set(remote);
    // Se agrega el track directo (no `event.streams[0]`): con transceivers pre-creados el receiver
    // puede no venir asociado a un stream, y así igual recibimos audio y video.
    pc.ontrack = event => {
      remote.addTrack(event.track);
    };

    pc.onicecandidate = event => {
      if (event.candidate) {
        this.sendSignal('ice', event.candidate.toJSON());
      }
    };

    pc.onnegotiationneeded = async () => {
      // Solo el que inició oferta (ver `isCaller`). El callee solo responde → evita glare y el
      // reordenamiento de m-lines que rechazaba la answer.
      if (!this.isCaller) {
        return;
      }
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.sendSignal('offer', pc.localDescription);
      } catch (err) {
        console.error('[ActiveCall] negotiationneeded error:', err);
      } finally {
        this.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        this.reconnecting.set(false);
        this.phase.set('active');
        // Anunciar mi estado de media al conectar: el par no recibe ningún mediaStatus hasta que
        // yo toggleo algo, así que sin esto su `peerVideoActive` queda en false y mi video se ve
        // como placeholder (iniciales) hasta el primer toggle. Publicarlo aquí lo pinta de una.
        this.publishMediaStatus();
      } else if (state === 'disconnected') {
        // Caída transitoria de ICE: puede recuperarse, NO cortamos — mostramos "Reconnecting…".
        this.reconnecting.set(true);
        this.setQuality('Disconnected');
      } else if (state === 'failed' || state === 'closed') {
        if (this.phase() !== 'ended') {
          this.reset();
        }
      }
    };

    this.startStatsPolling(pc);
  }

  // ---------- Calidad de conexión (getStats) ----------

  private startStatsPolling(pc: RTCPeerConnection): void {
    clearInterval(this.statsTimer);
    this.prevPacketsLost = 0;
    this.prevPacketsReceived = 0;
    this.statsTimer = setInterval(() => void this.sampleQuality(pc), STATS_POLL_MS);
  }

  private async sampleQuality(pc: RTCPeerConnection): Promise<void> {
    if (this.reconnecting() || pc.connectionState !== 'connected') {
      return; // reconectando: ya está en Disconnected; sin conexión no hay nada que medir
    }
    let rtt = 0;
    let totalLost = 0;
    let totalRecv = 0;
    try {
      const stats = await pc.getStats();
      stats.forEach(report => {
        const r = report as RTCStats & {
          nominated?: boolean;
          state?: string;
          currentRoundTripTime?: number;
          isRemote?: boolean;
          packetsLost?: number;
          packetsReceived?: number;
        };
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && typeof r.currentRoundTripTime === 'number') {
          rtt = r.currentRoundTripTime;
        }
        if (r.type === 'inbound-rtp' && !r.isRemote) {
          totalLost += r.packetsLost ?? 0;
          totalRecv += r.packetsReceived ?? 0;
        }
      });
    } catch {
      return;
    }
    // Delta desde el último muestreo (los contadores son acumulados) → pérdida reciente, no de por vida.
    const dLost = Math.max(0, totalLost - this.prevPacketsLost);
    const dRecv = Math.max(0, totalRecv - this.prevPacketsReceived);
    this.prevPacketsLost = totalLost;
    this.prevPacketsReceived = totalRecv;
    const loss = dLost + dRecv > 0 ? dLost / (dLost + dRecv) : 0;
    this.setQuality(this.deriveQuality(rtt, loss));
  }

  private deriveQuality(rtt: number, loss: number): CallConnectionQuality {
    if (rtt < 0.15 && loss < 0.02) {
      return 'Excellent';
    }
    if (rtt < 0.3 && loss < 0.05) {
      return 'Good';
    }
    if (rtt < 0.5 && loss < 0.1) {
      return 'Fair';
    }
    return 'Poor';
  }

  /** Actualiza la calidad local y la reporta al server solo cuando cambia (sin spamear el socket). */
  private setQuality(quality: CallConnectionQuality): void {
    this.connectionQuality.set(quality);
    if (quality !== this.lastReportedQuality) {
      this.lastReportedQuality = quality;
      const callId = this.callId();
      if (callId) {
        this.calls.connectionQuality(callId, quality);
      }
    }
  }

  private sendSignal(kind: 'offer' | 'answer' | 'ice', data: unknown): void {
    const callId = this.callId();
    const peerUserId = this.peerUserId();
    if (!callId || !peerUserId || !data) {
      return;
    }
    this.calls.signal(callId, peerUserId, kind, data as Record<string, unknown>);
  }

  private async handleSignal(kind: 'offer' | 'answer' | 'ice', data: unknown): Promise<void> {
    // Espera el armado COMPLETO (no solo `this.pc` truthy): las pistas locales deben estar agregadas
    // antes de construir la answer, o el m-line sale recvonly y el audio queda en un solo sentido.
    await this.ensurePeerConnection();
    const pc = this.pc;
    if (!pc) {
      return;
    }

    try {
      if (kind === 'offer') {
        const offerCollision = this.makingOffer || pc.signalingState !== 'stable';
        this.ignoreOffer = !this.isPolite && offerCollision;
        if (this.ignoreOffer) {
          return;
        }
        await pc.setRemoteDescription(data as RTCSessionDescriptionInit);
        await this.flushPendingCandidates(pc);
        await pc.setLocalDescription();
        this.sendSignal('answer', pc.localDescription);
      } else if (kind === 'answer') {
        // Una answer solo es válida si estamos esperando una (tenemos oferta local pendiente). Si ya
        // estamos `stable`, es una answer duplicada/stale → aplicarla lanza "Called in wrong state: stable"
        // y dejaba la negociación a medias. Se ignora sin ruido.
        if (pc.signalingState !== 'have-local-offer') {
          return;
        }
        await pc.setRemoteDescription(data as RTCSessionDescriptionInit);
        await this.flushPendingCandidates(pc);
      } else if (kind === 'ice') {
        const candidate = data as RTCIceCandidateInit;
        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidate);
        } else {
          // Llegó antes del remote description: se guarda y se aplica al setearlo.
          this.pendingCandidates.push(candidate);
        }
      }
    } catch (err) {
      if (!this.ignoreOffer) {
        console.error('[ActiveCall] signal handling error:', err);
      }
    }
  }

  private async flushPendingCandidates(pc: RTCPeerConnection): Promise<void> {
    const pending = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.error('[ActiveCall] buffered ICE candidate error:', err);
      }
    }
  }

  private reset(): void {
    // Fin abrupto (el par colgó, ICE falló) mientras grababa: rescatar lo grabado antes de limpiar.
    this.finalizeRecordingBackground();
    clearInterval(this.statsTimer);
    this.statsTimer = undefined;
    this.lastReportedQuality = null;
    this.prevPacketsLost = 0;
    this.prevPacketsReceived = 0;
    this.pc?.close();
    this.pc = null;
    this.pcReady = null;
    this.videoSender = null;
    this.pendingCandidates = [];
    this.screenTrack?.stop();
    this.screenTrack = null;
    this.cameraTrack = null;
    this.localStream()
      ?.getTracks()
      .forEach(t => t.stop());
    this.localStream.set(null);
    this.remoteStream.set(null);
    this.phase.set('idle');
    this.callId.set(null);
    this.peerUserId.set(null);
    this.peerDisplayName.set(null);
    this.conversationId.set(null);
    this.audioEnabled.set(true);
    this.videoEnabled.set(true);
    this.remoteAudioEnabled.set(true);
    this.screenSharing.set(false);
    this.peerVideoActive.set(false);
    this.connectionQuality.set('Good');
    this.reconnecting.set(false);
    this.recordingState.set('Idle');
    this.stopRecordingTimer();
    this.recordingConsentFrom.set(null);
    this._recordingRequesterId.set(null);
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.isCaller = false;
  }

  /** Cronómetro de la grabación en curso ("REC 0:12"). Tolera reentradas del evento Recording. */
  private startRecordingTimer(): void {
    if (this.recordingTimer) {
      return;
    }
    this.recordingStartedAt = Date.now();
    this.recordingElapsedMs.set(0);
    this.recordingTimer = setInterval(() => {
      this.recordingElapsedMs.set(Date.now() - this.recordingStartedAt);
    }, 250);
  }

  private stopRecordingTimer(): void {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
    this.recordingElapsedMs.set(0);
  }
}
