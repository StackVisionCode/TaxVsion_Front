import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '@shared/ui/toast/toast.service';
import { AuthService } from '@core/auth/auth.service';
import { SessionTeardownRegistry } from '@core/auth/session-teardown';
import { CALLS_RATE_LIMITED_MESSAGE, isSocketRateLimited, socketErrorCode } from '@core/errors/throttling';
import { CallsService } from './calls.service';
import {
  CallCaptureRequestedDto,
  CallDurationWarningDto,
  CallKind,
  CallRecordingState,
  CallRecordingStateChangedDto,
  CallStateDto,
  IceServer,
  callInitiateErrorMessage,
} from './call.model';
import { MediaPolicyService } from './media/media-policy.service';
import { ConnectionQuality, MediaPolicyDto } from './media/media-policy.model';
// Solo tipos: la capa de media (sesión, enlace, monitor, eco) se descarga al armar la PRIMERA llamada
// (`loadMediaLayer`), no con el shell — este servicio vive en el bundle inicial (overlay global).
import type { LocalMediaSession, LocalTrackSource, MuteReason } from './media/local-media-session';
import type { PeerLink, PeerSignalKind } from './media/peer-connection-factory';
import type { QualityMonitor } from './media/quality-monitor';
import type { QualityMetrics } from './media/derive-quality';
import type { EchoDetector } from './media/echo-detector';
import { SFU_CAPTURE_PUBLISHER_FACTORY, SfuCapturePublisherHandle } from './media/sfu-capture-publisher.factory';
import { ClientRecordingSession, RecordingUploadService } from './media/client-recording-session';
import { SoundsService } from './media/sounds.service';
import {
  RecordingCaptureMode,
  RecordingClock,
  isRecordingProcessing,
  recordingLimitWarningMessage,
  recordingStartErrorMessage,
  recordingStateNotice,
  usesClientCapture,
} from './recording-status';
import { MeetingSessionState } from './meeting-session-state';

export type ActiveCallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

/** Estados del servidor en los que la llamada sigue viva. */
const OPEN_CALL_STATUSES: ReadonlySet<string> = new Set(['Ringing', 'Accepted', 'Active']);

/** Cada cuánto avanza el cronómetro "REC 0:12". */
const RECORDING_TICK_MS = 250;
/** Copy del aviso de eco (D-51). */
const ECHO_NOTICE = "We're detecting echo from your side. Use headphones or lower your speaker volume.";
/** T-58: con una reunión en curso no se toma ni se inicia una llamada (el micrófono es de la reunión). */
const IN_MEETING_NOTICE = "You're in a meeting. Leave it to take calls.";

/**
 * Orquestador de la llamada 1:1 activa (mesh, D-56): estado de la llamada, reglas (quién oferta,
 * consentimiento de grabación, acks legibles, tope de minutos) y señalización. Un solo enlace a la vez.
 * Singleton — el overlay global (montado en el shell) solo LEE estos signals.
 *
 * F4: NO toca media ni RTCPeerConnection directamente. La captura vive en `LocalMediaSession`
 * (constraints de la política, placeholders, mute con liberación de hardware, pantalla con audio), el
 * enlace en `PeerLink` (perfect negotiation, ICE restart, Opus), la calidad en `QualityMonitor`
 * (T-48, D-39) con modo solo audio automático (D-40), el eco en `EchoDetector` (T-68), los sonidos en
 * `SoundsService` (T-70) y la grabación en `ClientRecordingSession` (C-03).
 *
 * Perfect-negotiation: el callee es "polite" (cede en colisión), el caller "impolite"; solo el que
 * INICIA oferta (el callee responde), así cámara/pantalla son `replaceTrack` sin renegociar ni glare.
 *
 * T-58 (exclusión llamada↔reunión): con una reunión activa (`MeetingSessionState`), una llamada entrante
 * se muestra como "In a meeting" (solo rechazar; el micrófono nunca se captura) y no se inicia ninguna.
 */
@Injectable({ providedIn: 'root' })
export class ActiveCallService {
  private readonly calls = inject(CallsService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly mediaPolicy = inject(MediaPolicyService);
  private readonly injector = inject(Injector);
  private readonly recordingUpload = inject(RecordingUploadService);
  private readonly sounds = inject(SoundsService);
  private readonly meetingState = inject(MeetingSessionState);
  private readonly createCapturePublisher = inject(SFU_CAPTURE_PUBLISHER_FACTORY);

  readonly phase = signal<ActiveCallPhase>('idle');
  /** T-58: hay una reunión en curso (cualquier fase viva). */
  readonly inMeeting = computed(() => {
    const meetingPhase = this.meetingState.phase();
    return meetingPhase !== 'idle' && meetingPhase !== 'ended';
  });
  /** T-58: llamada entrante mientras estoy en una reunión → modal "In a meeting" (solo Decline). */
  readonly incomingBlockedByMeeting = computed(() => this.phase() === 'incoming' && this.inMeeting());
  readonly callId = signal<string | null>(null);
  readonly kind = signal<CallKind>('Audio');
  readonly peerUserId = signal<string | null>(null);
  readonly peerDisplayName = signal<string | null>(null);
  /** Foto del par (`/storage/avatars/{id}`); null = iniciales. */
  readonly peerAvatarFileId = signal<string | null>(null);
  readonly conversationId = signal<string | null>(null);

  readonly localStream = signal<MediaStream | null>(null);
  /** Mi pantalla mientras comparto (separada de la cámara), para el escenario/PiP local. */
  readonly localScreenStream = signal<MediaStream | null>(null);
  /** CÁMARA del par (con su audio) y su PANTALLA (con su audio) — streams separados (dual-source). */
  readonly remoteCameraStream = signal<MediaStream | null>(null);
  readonly remoteScreenStream = signal<MediaStream | null>(null);
  readonly audioEnabled = signal(true);
  readonly videoEnabled = signal(true);
  readonly remoteAudioEnabled = signal(true);
  /** Estoy compartiendo mi pantalla. */
  readonly screenSharing = signal(false);
  /** Comparto también el audio de la pantalla (D-41). */
  readonly screenAudioSharing = signal(false);
  /** Motivo de la restricción vigente (mute por eco/host, video pausado por red); null = ninguna. */
  readonly muteReason = signal<MuteReason | null>(null);
  readonly videoPausedByNetwork = signal(false);
  /** El par tiene la CÁMARA encendida (para su tile/PiP vs placeholder de iniciales). */
  readonly peerCameraOn = signal(false);
  /** El par está compartiendo PANTALLA (para mostrar su pantalla en el escenario). */
  readonly peerScreenSharing = signal(false);
  /** Calidad de conexión propia (D-39) y sus cifras (solo staff las ve). */
  readonly connectionQuality = signal<ConnectionQuality | null>(null);
  readonly connectionMetrics = signal<QualityMetrics | null>(null);
  /** Calidad del PAR (`call.peer_quality_changed`); null = aún no reportó. */
  readonly peerQuality = signal<ConnectionQuality | null>(null);
  /** Aviso de tope de minutos (`call.duration.warning`); persiste hasta el siguiente umbral. */
  readonly durationWarning = signal<CallDurationWarningDto | null>(null);
  /** ICE cayó y está intentando reconectar (estado transitorio, puede recuperarse). */
  readonly reconnecting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  // ---------- Grabación ----------
  readonly recordingState = signal<CallRecordingState>('Idle');
  /** F7 — `Server` (el recorder captura del SFU) o `Client` (mezcla local); null hasta el primer estado. */
  readonly recordingCaptureMode = signal<RecordingCaptureMode | null>(null);
  /** Reloj del badge REC contra el reloj del servidor (`startedAtUtc`), con restante si hay tope. */
  private readonly recordingClock = new RecordingClock(() => this.calls.serverOffsetMs?.() ?? 0, RECORDING_TICK_MS);
  /** Tiempo transcurrido de la grabación en curso (ms) para mostrar "REC 0:12" junto al badge. */
  readonly recordingElapsedMs = this.recordingClock.elapsedMs;
  readonly recordingElapsedLabel = this.recordingClock.elapsedLabel;
  /** F7 — restante hasta el tope de la grabación ("4:37"); null sin tope. */
  readonly recordingRemainingLabel = this.recordingClock.remainingLabel;
  /** F7 — terminó de grabar y el servidor la compone/procesa ("Processing recording…"). */
  readonly recordingProcessing = computed(() => isRecordingProcessing(this.recordingState()));
  /** userId del que pidió grabar cuando ME toca responder el consentimiento (null = sin prompt). */
  readonly recordingConsentFrom = signal<string | null>(null);
  private readonly _recordingRequesterId = signal<string | null>(null);
  /** Soy el que pidió grabar (el que captura y sube el archivo). */
  readonly isRecordingRequester = computed(
    () => !!this._recordingRequesterId() && this._recordingRequesterId() === (this.auth.currentUser()?.id ?? null),
  );
  private readonly recording = new ClientRecordingSession();
  /** F7 (D-56) — publicador SFU de solo envío mientras el servidor graba la llamada (null = sin captura). */
  private capture: SfuCapturePublisherHandle | null = null;
  /** Se graba también la cámara (`captureVideo` del `capture_requested`). */
  private captureVideo = false;
  /** Invalida un armado de captura en vuelo (otro `capture_requested`, un stop o el fin de la llamada). */
  private captureSeq = 0;

  // ---------- Capa de media (F4) ----------
  private policy: MediaPolicyDto | null = null;
  private session: LocalMediaSession | null = null;
  private link: PeerLink | null = null;
  private monitor: QualityMonitor | null = null;
  private echo: EchoDetector | null = null;
  private iceServers: IceServer[] = [];
  /**
   * Latch del armado del enlace: `ensurePeerConnection` se dispara desde varios eventos casi
   * simultáneos (peer_joined, state_changed 'Accepted', accept/startCall) y tiene awaits (ICE +
   * captura); sin latch, dos disparos armaban DOS enlaces y una oferta en ese hueco salía sin pistas.
   */
  private pcReady: Promise<void> | null = null;
  private isPolite = false;
  /** Solo el que INICIA la llamada crea la oferta; el callee solo responde (evita glare y reordenar m-lines). */
  private isCaller = false;
  private connectedOnce = false;
  private listenersBound = false;

  constructor() {
    // F3 — al cerrar sesión (logout / `session.revoked`) la llamada se cuelga y suelta la media.
    inject(SessionTeardownRegistry).register(() => this.endCall());
  }

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
      this.peerAvatarFileId.set(dto.callerAvatarFileId ?? null);
      this.conversationId.set(dto.conversationId);
      this.isPolite = true; // el callee es polite
      this.isCaller = false; // el callee responde, no oferta
      this.phase.set('incoming');
    });

    this.calls.onStateChanged().subscribe(dto => {
      if (dto.callId !== this.callId()) {
        return;
      }
      void this.handleStateChanged(dto);
    });

    // El socket se reconectó (p. ej. reinicio del servidor en un deploy): la media P2P sigue, pero el canal
    // nuevo no está en la room de la llamada. Sin `rejoin` no llegan señales ni el fin, y el servidor la
    // cerraría como abandonada.
    this.calls.reconnected$.subscribe(() => void this.rejoinAfterReconnect());

    this.calls.onPeerJoined().subscribe(dto => {
      if (dto.callId !== this.callId()) {
        return;
      }
      this.isPolite = dto.isPolite;
      // Al aceptar llega la foto del par (ausente = se conserva la que ya había).
      if (dto.avatarFileId !== undefined) {
        this.peerAvatarFileId.set(dto.avatarFileId ?? null);
      }
      void this.ensurePeerConnection();
    });

    // Si el par cambia su foto/nombre durante la llamada, se refleja al instante.
    this.calls.onUserProfileChanged().subscribe(change => {
      if (!change?.userId || change.userId !== this.peerUserId()) {
        return;
      }
      if (change.avatarFileId !== undefined) {
        this.peerAvatarFileId.set(change.avatarFileId ?? null);
      }
      if (change.displayName) {
        this.peerDisplayName.set(change.displayName);
      }
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
      this.peerCameraOn.set(dto.videoEnabled);
      this.peerScreenSharing.set(dto.screenSharing);
    });

    this.calls.onUpgradedToVideo().subscribe(dto => {
      if (dto.callId !== this.callId()) {
        return;
      }
      // El par pasó la llamada a video: su track ya fluye por el sender pre-creado (sin renegociar).
      if (this.kind() !== 'Video') {
        this.kind.set('Video');
      }
    });

    // ----- F4: calidad del par y tope de minutos -----
    this.calls.onPeerQualityChanged().subscribe(dto => {
      if (dto.callId === this.callId() && dto.peerUserId === this.peerUserId()) {
        this.peerQuality.set(dto.quality);
      }
    });
    this.calls.onDurationWarning().subscribe(dto => {
      if (dto.callId !== this.callId()) {
        return;
      }
      this.durationWarning.set(dto);
      this.sounds.play('notification', { isHost: true });
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
        this.recordingConsentFrom.set(dto.requestedByUserId); // modal global al otro
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
      this.applyRecordingState(dto);
    });

    // F7 — aviso de tope de la grabación; al llegar al tope el servidor la para (la llamada sigue).
    this.calls.onRecordingLimitWarning().subscribe(dto => {
      if (dto.callId === this.callId()) {
        this.toast.info(recordingLimitWarningMessage(dto.remainingSeconds));
      }
    });

    // F7 (D-56) — captura en servidor: publicar mi micro (y cámara) al SFU de grabación, solo envío.
    this.calls.onCaptureRequested().subscribe(dto => {
      if (dto.callId === this.callId()) {
        void this.startCapture(dto);
      }
    });
    this.calls.onCaptureStopped().subscribe(dto => {
      if (dto.callId === this.callId()) {
        this.stopCapture();
      }
    });

    this.calls.onTranscriptReady().subscribe(dto => {
      if (dto.callId !== this.callId()) {
        return;
      }
      this.toast.success('The call transcript is ready.');
    });
  }

  async startCall(
    peerUserId: string,
    peerDisplayName: string,
    kind: CallKind,
    conversationId?: string,
    peerAvatarFileId?: string | null,
  ): Promise<void> {
    if (this.phase() !== 'idle') {
      return;
    }
    if (this.inMeeting()) {
      this.toast.info(IN_MEETING_NOTICE);
      return;
    }
    this.errorMessage.set(null);
    this.peerUserId.set(peerUserId);
    this.peerDisplayName.set(peerDisplayName);
    this.peerAvatarFileId.set(peerAvatarFileId ?? null);
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
      this.sounds.play('ringing', { isHost: true });
    } catch (err) {
      const code = socketErrorCode(err);
      this.toast.error(
        callInitiateErrorMessage(code, (err as { message?: string } | null)?.message) ??
          (isSocketRateLimited(code) ? CALLS_RATE_LIMITED_MESSAGE : 'Could not start the call.'),
      );
      this.reset();
    }
  }

  async acceptIncoming(): Promise<void> {
    const callId = this.callId();
    if (!callId) {
      return;
    }
    if (this.inMeeting()) {
      this.toast.info(IN_MEETING_NOTICE); // defensa: la UI solo ofrece Decline
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
    // Colgar una llamada SALIENTE que aún suena (Ringing) es un CANCEL, no un END: el backend rechaza
    // `end` fuera de Accepted/Active y el modal de "incoming" del callee se quedaba pegado.
    const cancelling = this.phase() === 'outgoing';
    // Si estoy grabando, capturo el blob ANTES de cortar las pistas (la subida va en background).
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
        if (cancelling) {
          await this.calls.cancel(callId);
        } else {
          await this.calls.end(callId);
        }
      } catch {
        /* noop */
      }
    }
    if (pendingBlob && callId) {
      void this.uploadRecording(callId, pendingBlob);
    }
    this.reset();
  }

  // ---------- Controles de media (delegan en la sesión local) ----------

  async toggleAudio(): Promise<void> {
    if (!this.session) {
      this.audioEnabled.update(v => !v);
      return;
    }
    await this.session.setAudioEnabled(!this.session.audioEnabled(), 'user');
    this.syncFromSession();
    this.publishMediaStatus();
  }

  async toggleVideo(): Promise<void> {
    if (!this.session) {
      return;
    }
    const ok = await this.session.setVideoEnabled(!this.session.videoEnabled());
    if (!ok) {
      this.toast.error('Allow camera access to turn on video.');
    }
    this.syncFromSession();
    this.publishMediaStatus();
  }

  /** Pasa una llamada de audio ACTIVA a video encendiendo la cámara (replaceTrack, sin renegociar). */
  async upgradeToVideo(): Promise<void> {
    const callId = this.callId();
    if (!callId || this.kind() !== 'Audio' || this.phase() !== 'active' || !this.session) {
      return;
    }
    const ok = await this.session.setVideoEnabled(true);
    if (!ok) {
      this.toast.error('Allow camera access to turn on video.');
      return;
    }
    this.kind.set('Video');
    this.syncFromSession();
    try {
      await this.calls.upgradeToVideo(callId);
    } catch {
      // El media ya fluye y la UI local ya cambió; el evento al par es best-effort.
    }
    this.publishMediaStatus();
  }

  /** Cambio de micrófono en caliente (panel Devices). */
  async swapMicrophone(deviceId: string): Promise<boolean> {
    const ok = (await this.session?.swapMicrophone(deviceId)) ?? false;
    if (!ok) this.toast.error('Could not switch the microphone. Keeping the current one.');
    this.syncFromSession();
    return ok;
  }

  /** Cambio de cámara en caliente (panel Devices). */
  async swapCamera(deviceId: string): Promise<boolean> {
    const ok = (await this.session?.swapCamera(deviceId)) ?? false;
    if (!ok) this.toast.error('Could not switch the camera. Keeping the current one.');
    this.syncFromSession();
    return ok;
  }

  /**
   * Compartir pantalla ADITIVO (no toca la cámara): el par ve cámara Y pantalla a la vez.
   * `withAudio` (D-41): audio de la pantalla si el usuario lo pide y la política lo permite.
   */
  async startScreenShare(withAudio = false): Promise<void> {
    const callId = this.callId();
    if (!callId || this.phase() !== 'active' || !this.session || this.session.screenSharing()) {
      return;
    }
    const started = await this.session.startScreenShare({ withAudio: withAudio && (this.policy?.screenShare.audioAllowed ?? false) });
    if (!started) {
      return; // el usuario canceló el selector; sin ruido
    }
    this.syncFromSession();
    try {
      await this.calls.startScreenShare(callId);
    } catch {
      /* el media ya fluye; la señal es best-effort */
    }
    this.publishMediaStatus();
  }

  async stopScreenShare(): Promise<void> {
    await this.session?.stopScreenShare(); // `onScreenShareStopped` avisa al server y publica el estado
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
    } catch (err) {
      const code = socketErrorCode(err);
      this.toast.error(
        recordingStartErrorMessage(code) ?? (isSocketRateLimited(code) ? CALLS_RATE_LIMITED_MESSAGE : 'Could not start recording.'),
      );
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
      void this.uploadRecording(callId, blob);
    }
  }

  /** Si terminó la llamada mientras grababa (fin abrupto), captura lo grabado y lo sube igual. */
  private finalizeRecordingBackground(): void {
    const callId = this.callId();
    if (!this.isRecordingRequester() || !callId || !this.recording.active) {
      return;
    }
    void this.recording.stop().then(blob => {
      if (blob && blob.size > 0) {
        void this.uploadRecording(callId, blob);
      }
    });
  }

  private uploadRecording(callId: string, blob: Blob): Promise<void> {
    return this.recordingUpload.uploadAndAttach(callId, 'call-recording', blob, fileId => this.calls.attachRecording(callId, fileId));
  }

  /**
   * F7 — aplica `call.recording.state_changed`. Con `captureMode: 'Server'` el navegador NO mezcla ni
   * sube (captura el recorder vía `capture_requested`); la mezcla local queda para `Client` o sin campo.
   */
  private applyRecordingState(dto: CallRecordingStateChangedDto): void {
    this.recordingState.set(dto.state);
    if (dto.captureMode !== undefined) {
      this.recordingCaptureMode.set(dto.captureMode);
    }
    if (dto.state === 'Recording') {
      this.recordingClock.start(dto.startedAtUtc, dto.maxDurationSeconds);
      if (usesClientCapture(dto) && this.isRecordingRequester() && this.policy && !this.recording.active) {
        void this.recording.start(
          [this.localStream(), this.remoteCameraStream(), this.remoteScreenStream()],
          this.policy.audio.clientRecordingKbps,
        );
      }
      return;
    }
    this.recordingClock.stop();
    const notice = recordingStateNotice(dto);
    if (notice?.tone === 'error') {
      this.toast.error(notice.message);
    } else if (notice) {
      this.toast.info(notice.message);
    }
    if (dto.state === 'Failed' || dto.state === 'Idle') {
      this.stopCapture();
    }
  }

  // ---------- F7 (D-56): captura vía SFU de solo envío ----------

  /** Arma el publicador (carga perezosa) con mi micro y, si se graba video y la cámara está encendida, la cámara. */
  private async startCapture(dto: CallCaptureRequestedDto): Promise<void> {
    this.stopCapture();
    const seq = ++this.captureSeq;
    const session = this.session;
    if (!session) {
      return;
    }
    const callId = dto.callId;
    const publisher = await this.createCapturePublisher({
      signaling: {
        createTransport: () => this.calls.sfuCreateTransport(callId),
        connectTransport: (transportId, dtlsParameters) => this.calls.sfuConnectTransport(callId, transportId, dtlsParameters),
        produce: (transportId, kind, rtpParameters, source) => this.calls.sfuProduce(callId, transportId, kind, rtpParameters, source),
      },
      iceServers: this.iceServers as RTCIceServer[],
      policy: this.policy,
    });
    if (seq !== this.captureSeq || this.callId() !== callId || this.session !== session) {
      publisher.close();
      return;
    }
    this.capture = publisher;
    this.captureVideo = dto.captureVideo ?? dto.video ?? false;
    const ok = await publisher.start(dto.routerRtpCapabilities, {
      audio: session.audioOutTrack(),
      camera: this.captureCameraTrack(session.cameraOutTrack()),
    });
    if (!ok && this.capture === publisher) {
      this.capture = null;
    }
  }

  /** Cierra la captura (fin pedido por el servidor, fallo, fin de la llamada). La llamada mesh no se toca. */
  private stopCapture(): void {
    this.captureSeq++;
    this.capture?.close();
    this.capture = null;
    this.captureVideo = false;
  }

  /** La cámara solo se publica si se graba video y está encendida (apagada = placeholder → no se envía). */
  private captureCameraTrack(track: MediaStreamTrack | null): MediaStreamTrack | null {
    return this.captureVideo && this.session?.videoEnabled() ? track : null;
  }

  // ---------- Estado / señalización ----------

  private publishMediaStatus(): void {
    const callId = this.callId();
    if (!callId) {
      return;
    }
    this.calls.mediaStatus(callId, this.audioEnabled(), this.videoEnabled(), this.screenSharing());
  }

  /** Copia a los signals públicos el estado de la sesión local (única fuente de verdad de mic/cámara/pantalla). */
  private syncFromSession(): void {
    const session = this.session;
    if (!session) {
      return;
    }
    this.audioEnabled.set(session.audioEnabled());
    this.videoEnabled.set(session.videoEnabled());
    this.screenSharing.set(session.screenSharing());
    this.screenAudioSharing.set(!!session.screenAudioTrack());
    this.localStream.set(session.stream());
    this.localScreenStream.set(session.screenStream());
    this.muteReason.set(session.muteReason());
    this.videoPausedByNetwork.set(session.videoPausedByNetwork());
  }

  private async handleStateChanged(dto: CallStateDto): Promise<void> {
    const status = dto.status;
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
      // Llamada SALIENTE que nadie contestó (par offline / no disponible): feedback inmediato al caller.
      if (status === 'MissedCall' && this.isCaller) {
        this.toast.info(`Could not reach ${this.peerDisplayName() || 'the contact'}.`);
      } else if (status === 'Ended' && dto.endReason === 'MaxDurationReached') {
        this.toast.info('Call ended: time limit reached');
      } else if (status === 'Ended' && dto.endReason === 'Abandoned') {
        this.toast.info('Call ended: the connection was lost.');
      }
      this.reset();
    }
  }

  private async rejoinAfterReconnect(): Promise<void> {
    const callId = this.callId();
    const phase = this.phase();
    // El que recibe la llamada todavía no está en la room hasta aceptar.
    if (!callId || (phase !== 'outgoing' && phase !== 'connecting' && phase !== 'active')) {
      return;
    }
    try {
      const { state } = await this.calls.rejoin(callId);
      // Abierta: nada que hacer (no se retrocede la pantalla). Terminada mientras no estábamos: se cierra.
      if (state.callId === this.callId() && !OPEN_CALL_STATUSES.has(state.status)) {
        await this.handleStateChanged(state);
      }
    } catch {
      // Sin respuesta: la llamada sigue en pantalla; si de verdad se perdió, llega el fin o el usuario cuelga.
    }
  }

  /** Arma el enlace UNA sola vez por llamada; disparos concurrentes esperan el mismo armado. */
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
    if (this.link) {
      return;
    }
    try {
      this.policy = await this.mediaPolicy.ensureLoaded();
    } catch {
      this.errorMessage.set('Could not load the call settings.');
      this.toast.error('Could not load the call settings. Please try again.');
      void this.endCall();
      return;
    }
    const policy = this.policy;
    const media = await this.loadMediaLayer();
    try {
      const ice = await firstValueFrom(this.calls.getIceServers());
      this.iceServers = ice.iceServers;
    } catch {
      // Degradación consciente: STUN público si /webrtc/ice falla (puede no atravesar NAT sin TURN).
      this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }
    if (this.phase() === 'idle' || this.phase() === 'ended') {
      return; // la llamada terminó mientras esperábamos
    }

    // Captura local con la política (AEC/NS/AGC, resolución); `preferAudioOnly` entra sin pedir cámara.
    const session = media.sessionFactory.create(policy, {
      onLocalTrackReplaced: (source, track) => this.applyLocalTrack(source, track),
      onScreenShareStopped: () => this.onScreenShareStopped(),
    });
    this.session = session;
    const wantVideo = this.kind() === 'Video' && !policy.preferences.preferAudioOnly;
    const acquired = await session.acquire({ audio: true, video: wantVideo, profile: 'camera' });
    if (!acquired.audio) {
      // Sin micrófono no hay llamada: abortar con aviso claro.
      this.errorMessage.set(acquired.audioError?.message ?? 'Could not access your microphone/camera.');
      this.toast.error(acquired.audioError?.guidance ?? acquired.audioError?.message ?? 'Allow microphone access to start the call.');
      void this.endCall();
      return;
    }
    if (wantVideo && !acquired.video) {
      this.toast.info(acquired.videoError?.message ?? 'Could not access your camera.');
    }
    this.syncFromSession();

    const link = media.peerFactory.create({
      iceServers: this.iceServers as RTCIceServer[],
      isPolite: () => this.isPolite,
      canOffer: () => this.isCaller,
      local: {
        microphone: session.audioOutTrack(),
        camera: session.cameraOutTrack(),
        screen: session.screenOutTrack(),
        screenAudio: session.screenAudioOutTrack(),
        stream: session.stream(),
        screenStream: session.screenOutStream(),
      },
      opus: { fec: policy.audio.opusFec, dtx: policy.audio.opusDtx, maxAverageBitrateKbps: policy.audio.maxAverageBitrateKbps },
      signal: (kind, data) => this.sendSignal(kind, data),
      onConnected: () => this.onLinkConnected(),
      onLinkState: state => {
        if (state === 'reconnecting') {
          // Caída transitoria de ICE: puede recuperarse, NO cortamos — mostramos "Reconnecting…".
          this.reconnecting.set(true);
          this.monitor?.forceLevel('Disconnected');
        } else if (state === 'ok') {
          this.reconnecting.set(false);
        } else if (this.phase() !== 'ended') {
          this.reset(); // reintentos agotados
        }
      },
      onClosed: () => {
        if (this.phase() !== 'ended') {
          this.reset();
        }
      },
    });
    this.link = link;
    this.remoteCameraStream.set(link.remoteCameraStream);
    this.remoteScreenStream.set(link.remoteScreenStream);

    this.echo = policy.echo.detectionEnabled ? new media.EchoDetector(undefined, () => this.onEchoSuspected()) : null;
    this.monitor = new media.QualityMonitor({
      policy: policy.quality,
      sample: async () => [await link.collectStats()],
      isConnected: () => link.connectionState === 'connected',
      onLevelChanged: (level, metrics) => this.onQualityChanged(level, metrics),
      onSample: reports => this.echo?.push(reports),
      onSustainedPoor: () => this.enterAudioOnly(),
      onRecovered: () => this.leaveAudioOnly(),
    });
    this.monitor.start();
  }

  /** Descarga la capa de media bajo demanda (R2): sesión local, fábrica de enlaces, monitor y eco. */
  private async loadMediaLayer() {
    const [sessionMod, peerMod, monitorMod, echoMod] = await Promise.all([
      import('./media/local-media-session.factory'),
      import('./media/peer-connection-factory'),
      import('./media/quality-monitor'),
      import('./media/echo-detector'),
    ]);
    return {
      sessionFactory: this.injector.get(sessionMod.LocalMediaSessionFactory),
      peerFactory: this.injector.get(peerMod.PeerConnectionFactory),
      QualityMonitor: monitorMod.QualityMonitor,
      EchoDetector: echoMod.EchoDetector,
    };
  }

  private onLinkConnected(): void {
    this.reconnecting.set(false);
    this.phase.set('active');
    if (!this.connectedOnce) {
      this.connectedOnce = true;
      this.sounds.play('connected', { isHost: true });
    }
    // Anunciar mi estado de media al conectar: sin esto el par asume placeholder hasta el primer toggle.
    this.publishMediaStatus();
  }

  /** Una pista local cambió (cámara, micro, pantalla): aplicarla al sender correspondiente. */
  private applyLocalTrack(source: LocalTrackSource, track: MediaStreamTrack | null): Promise<void> {
    this.syncFromSession();
    // F7 — la captura de la grabación sigue al micro y a la cámara (cambio de dispositivo, on/off).
    if (source === 'microphone') {
      void this.capture?.setTrack('audio', track);
    } else if (source === 'camera') {
      void this.capture?.setTrack('camera', this.captureCameraTrack(track));
    }
    return this.link?.replaceTrack(source, track) ?? Promise.resolve();
  }

  private onScreenShareStopped(): void {
    this.syncFromSession();
    const callId = this.callId();
    if (callId) {
      void this.calls.stopScreenShare(callId).catch(() => undefined);
    }
    this.publishMediaStatus();
  }

  // ---------- Calidad (T-48 / D-39 / D-40) y eco (T-68) ----------

  /** Actualiza la calidad local y la reporta al server solo cuando cambia (sin spamear el socket). */
  private onQualityChanged(level: ConnectionQuality, metrics: QualityMetrics | null): void {
    this.connectionQuality.set(level);
    this.connectionMetrics.set(metrics);
    const callId = this.callId();
    if (callId) {
      this.calls.connectionQuality(callId, level, metrics);
    }
  }

  /** Poor sostenido: pausar mi cámara para proteger el audio (el estado del usuario no cambia). */
  private enterAudioOnly(): void {
    if (!this.session || this.session.videoPausedByNetwork()) {
      return;
    }
    this.session.pauseVideoForNetwork();
    this.syncFromSession();
    this.toast.info('Video paused to protect audio');
  }

  /** Recuperación: en mesh no hay capas, se reanuda la cámara de una (true = recuperado del todo). */
  private leaveAudioOnly(): boolean {
    this.session?.resumeVideoAfterNetwork();
    this.syncFromSession();
    return true;
  }

  private onEchoSuspected(): void {
    const policy = this.policy;
    if (!policy || !this.session) {
      return;
    }
    this.toast.info(ECHO_NOTICE);
    if (policy.echo.muteOnEcho && this.session.audioEnabled()) {
      void this.session.setAudioEnabled(false, 'echo').then(() => {
        this.syncFromSession();
        this.publishMediaStatus();
      });
    }
  }

  private sendSignal(kind: PeerSignalKind, data: Record<string, unknown>): void {
    const callId = this.callId();
    const peerUserId = this.peerUserId();
    if (!callId || !peerUserId || !data) {
      return;
    }
    this.calls.signal(callId, peerUserId, kind, data);
  }

  private async handleSignal(kind: PeerSignalKind, data: unknown): Promise<void> {
    // Espera el armado COMPLETO: las pistas locales deben estar en el enlace antes de construir la
    // answer, o el m-line sale recvonly y el audio queda en un solo sentido.
    await this.ensurePeerConnection();
    await this.link?.handleSignal(kind, data);
  }

  private reset(): void {
    const wasLive = this.phase() === 'active' || this.phase() === 'connecting';
    // Fin abrupto (el par colgó, ICE falló) mientras grababa: rescatar lo grabado antes de limpiar.
    this.finalizeRecordingBackground();
    this.stopCapture();
    this.monitor?.stop();
    this.monitor = null;
    this.echo = null;
    this.link?.close();
    this.link = null;
    this.pcReady = null;
    this.session?.release();
    this.session = null;
    this.policy = null;
    this.localStream.set(null);
    this.localScreenStream.set(null);
    this.remoteCameraStream.set(null);
    this.remoteScreenStream.set(null);
    this.phase.set('idle');
    this.callId.set(null);
    this.peerUserId.set(null);
    this.peerDisplayName.set(null);
    this.peerAvatarFileId.set(null);
    this.conversationId.set(null);
    this.audioEnabled.set(true);
    this.videoEnabled.set(true);
    this.remoteAudioEnabled.set(true);
    this.screenSharing.set(false);
    this.screenAudioSharing.set(false);
    this.muteReason.set(null);
    this.videoPausedByNetwork.set(false);
    this.peerCameraOn.set(false);
    this.peerScreenSharing.set(false);
    this.connectionQuality.set('Good');
    this.connectionMetrics.set(null);
    this.peerQuality.set(null);
    this.durationWarning.set(null);
    this.reconnecting.set(false);
    this.recordingState.set('Idle');
    this.recordingCaptureMode.set(null);
    this.recordingClock.stop();
    this.recordingConsentFrom.set(null);
    this._recordingRequesterId.set(null);
    this.isCaller = false;
    this.connectedOnce = false;
    if (wasLive) {
      this.sounds.play('ended', { isHost: true });
    }
  }
}
