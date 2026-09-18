import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom, map, switchMap } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { ApiConfigService } from '@core/config/api-config.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { InitiateUploadRequest } from '@core/cloud-storage/cloud-storage.model';
import { MeetingChatMessageDto } from './meeting.model';
import { MeetingRtcService } from './meeting-rtc.service';
import { MeetingSfuService } from './meeting-sfu.service';
import { CallsService } from './calls.service';
import { CallRecordingService } from './call-recording.service';
import { IceServer } from './call.model';
import { MeetingParticipantDto, MeetingRecordingState, MeetingRole, MeetingSnapshotDto, MeetingStrategy } from './meeting.model';

export type ActiveMeetingPhase = 'idle' | 'joining' | 'waiting' | 'passcode' | 'joined' | 'unsupported' | 'ended';

/** Mensaje del chat del meeting, ya en shape de vista. */
export interface MeetingChatMessage {
  id: string;
  senderName: string;
  text: string;
  time: string;
  isMine: boolean;
}

/** Un peer remoto y su MediaStream (mesh). */
export interface MeetingPeer {
  userId: string;
  stream: MediaStream;
}

/**
 * Estado de negociación por peer (perfect negotiation, patrón MDN). NO se bufferean candidatos a mano:
 * el `RTCPeerConnection` ya encola `addIceCandidate` detrás de `setRemoteDescription`; bufferear a mano
 * rompía el ICE con glare (`Unknown ufrag`). `videoSender` es un sender de video PERSISTENTE (transceiver
 * sendrecv) para prender/apagar/compartir vía `replaceTrack` sin renegociar (y apagar la cámara físicamente).
 */
interface PeerConn {
  pc: RTCPeerConnection;
  isPolite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  videoSender: RTCRtpSender | null;
}

/**
 * Estado de la sesión de meeting activa. 3A: join, sala de espera, snapshot y el gate
 * de SFU — SIN media todavía (el mesh WebRTC llega en 3B). El backend usa `strategy:'Sfu'`
 * para meetings >4 participantes (mediasoup); el CRM no lo soporta aún, así que se muestra
 * `phase='unsupported'` con un mensaje claro en vez de intentar mesh o pantalla negra.
 *
 * Corrige dos cosas del ActiveMeetingService del Portal (que estaba desactualizado): usa el
 * contrato real de `participant.changed` (anida `participant` con `status`) y sí gatea `strategy`.
 */
@Injectable({ providedIn: 'root' })
export class ActiveMeetingService {
  private readonly rtc = inject(MeetingRtcService);
  private readonly auth = inject(AuthService);
  private readonly calls = inject(CallsService);
  private readonly toast = inject(ToastService);
  private readonly recording = inject(CallRecordingService);
  private readonly cloudStorage = inject(CloudStorageUploadService);
  private readonly sfu = inject(MeetingSfuService);
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  readonly phase = signal<ActiveMeetingPhase>('idle');
  readonly meetingId = signal<string | null>(null);
  readonly meetingTitle = signal<string>('');
  readonly conversationId = signal<string | null>(null);
  readonly participants = signal<MeetingParticipantDto[]>([]);
  readonly yourRole = signal<MeetingRole>('Attendee');
  readonly strategy = signal<MeetingStrategy>('Mesh');
  readonly isLocked = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly myUserId = signal<string | null>(null);

  // ---------- Media (mesh) ----------
  readonly localStream = signal<MediaStream | null>(null);
  readonly audioEnabled = signal(true);
  readonly videoEnabled = signal(true);
  readonly handRaised = signal(false);
  readonly screenSharing = signal(false);
  /** Peers remotos y sus streams, por userId. */
  readonly peers = signal<Map<string, MeetingPeer>>(new Map());

  /** Chat del meeting (live-only en este slice: mensajes desde que entraste). */
  readonly chatMessages = signal<MeetingChatMessage[]>([]);

  // ---------- Grabación ----------
  readonly recordingState = signal<MeetingRecordingState>('Idle');
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
  readonly isRecordingRequester = computed(
    () => !!this._recordingRequesterId() && this._recordingRequesterId() === (this.auth.currentUser()?.id ?? null),
  );

  readonly isHost = computed(() => this.yourRole() === 'Host' || this.yourRole() === 'Cohost');
  /** Participantes efectivamente dentro (no en espera ni salidos) — para la grilla. */
  readonly joinedParticipants = computed(() => this.participants().filter(p => p.status === 'Joined'));
  /** Participantes dentro que NO soy yo (para las tiles remotas). */
  readonly remoteParticipants = computed(() => this.joinedParticipants().filter(p => p.userId !== this.myUserId()));
  /** En sala de espera (solo el host los ve para admitir/denegar). */
  readonly waitingParticipants = computed(() => this.participants().filter(p => p.status === 'Waiting'));

  private readonly peerConns = new Map<string, PeerConn>();
  private iceServers: IceServer[] = [];
  /** Track de cámara (para restaurar tras compartir pantalla). */
  private cameraTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  /** Stream de una pista de video negra deshabilitada — mantiene vivo el m-line de video cuando no hay
   * cámara, para que prender/compartir sea replaceTrack sin renegociar. Se crea una vez y se reusa. */
  private placeholderStream: MediaStream | null = null;
  private chatHistoryLoaded = false;
  private listenersBound = false;

  private bindListenersOnce(): void {
    if (this.listenersBound) {
      return;
    }
    this.listenersBound = true;

    // El backend NO emite `meeting.snapshot` para el join directo (el snapshot llega inline en el
    // ack del join → lo aplica `join()`); este evento solo se emite al ADMITIR desde la sala de
    // espera. Se deja suscrito para esa transición waiting→joined y como fallback idempotente.
    this.rtc.onSnapshot().subscribe(snap => this.applySnapshot(snap));

    // Reconnect transparente del socket (churn del tunnel): si seguimos dentro de un meeting, re-unir
    // la room `m:` para no perder participantes/controles/señalización. La media mesh sigue viva; solo
    // se reconcilia el roster. La room de chat del meeting la re-une el join-on-connect del server.
    this.rtc.reconnected$.subscribe(() => void this.handleSocketReconnected());

    this.rtc.onParticipantChanged().subscribe(dto => {
      if (dto.meetingId !== this.meetingId()) {
        return;
      }
      this.applyParticipantChange(dto.participant);
      const p = dto.participant;
      if (p.userId === this.myUserId() || this.strategy() === 'Sfu') {
        return; // en SFU el media lo maneja mediasoup (consumers), no el mesh
      }
      if (p.status === 'Left' || p.status === 'Removed') {
        this.disconnectFromPeer(p.userId);
      } else if (p.status === 'Joined') {
        this.connectToPeer(p.userId);
      }
    });

    this.rtc.onSignalFrom().subscribe(dto => {
      if (dto.meetingId !== this.meetingId()) {
        return;
      }
      void this.handleSignal(dto.fromPeerUserId, dto.kind, dto.data);
    });

    this.rtc.onMutedByHost().subscribe(dto => {
      if (dto.meetingId !== this.meetingId() || !this.audioEnabled()) {
        return;
      }
      // El host silenció a todos: bajo mi audio localmente y aviso.
      this.audioEnabled.set(false);
      this.localStream()
        ?.getAudioTracks()
        .forEach(t => (t.enabled = false));
      this.rtc.mediaStatus(this.meetingId()!, false, this.videoEnabled(), false);
      this.toast.info('You were muted by the host.');
    });

    this.rtc.onChatMessageNew().subscribe(dto => {
      if (dto.conversationId !== this.conversationId()) {
        return;
      }
      this.chatMessages.update(list => {
        if (list.some(m => m.id === dto.id)) {
          return list; // dedupe (el propio broadcast del remitente)
        }
        return [...list, this.toChatView(dto)];
      });
    });

    this.rtc.onStateChanged().subscribe(dto => {
      if (dto.meetingId !== this.meetingId()) {
        return;
      }
      this.isLocked.set(dto.isLocked);
      if (dto.status === 'Ended' || dto.status === 'Cancelled') {
        this.phase.set('ended');
        this.stopLocalMedia(); // apagar cámara/mic al terminar el meeting (no se llega por leave())
      }
    });

    // ----- Grabación (consentimiento + estado) -----
    this.rtc.onRecordingConsentRequested().subscribe(dto => {
      if (dto.meetingId !== this.meetingId()) {
        return;
      }
      this._recordingRequesterId.set(dto.requestedByUserId);
      this.recordingState.set('Requesting');
      if (dto.requestedByUserId === (this.auth.currentUser()?.id ?? null)) {
        void this.rtc.respondRecordingConsent(dto.meetingId, 'Accepted').catch(() => undefined); // el que pide, consiente
      } else {
        this.recordingConsentFrom.set(dto.requestedByUserId); // modal a los demás
      }
    });

    this.rtc.onRecordingConsentRecorded().subscribe(dto => {
      if (dto.meetingId !== this.meetingId()) {
        return;
      }
      if (dto.response === 'Rejected') {
        this.toast.info('A participant declined the recording.');
      }
    });

    this.rtc.onRecordingStateChanged().subscribe(dto => {
      if (dto.meetingId !== this.meetingId()) {
        return;
      }
      this.recordingState.set(dto.state);
      if (dto.state === 'Recording') {
        this.startRecordingTimer();
        if (this.isRecordingRequester()) {
          const streams = [this.localStream(), ...[...this.peers().values()].map(p => p.stream)];
          this.recording.start(...streams);
        }
      } else {
        this.stopRecordingTimer();
        if (dto.state === 'Failed') {
          this.toast.error('The recording failed.');
        } else if (dto.state === 'Idle') {
          this.recordingConsentFrom.set(null);
          this._recordingRequesterId.set(null);
        }
      }
    });

    this.rtc.onTranscriptReady().subscribe(dto => {
      if (dto.meetingId !== this.meetingId()) {
        return;
      }
      this.toast.success('The meeting transcript is ready.');
    });

    this.rtc.onParticipantDenied().subscribe(dto => {
      if (dto.meetingId !== this.meetingId() || dto.participantUserId !== this.myUserId()) {
        return;
      }
      this.errorMessage.set('The host declined your request to join.');
      this.phase.set('ended');
      this.stopLocalMedia();
    });

    this.rtc.onCancelled().subscribe(dto => {
      if (dto.meetingId !== this.meetingId()) {
        return;
      }
      this.errorMessage.set('This meeting was cancelled.');
      this.phase.set('ended');
      this.stopLocalMedia();
    });
  }

  /**
   * Aplica el snapshot autoritativo de "ya estás dentro" (strategy, participantes, rol, conversationId):
   * llega inline en el ack del join directo, o por el evento `meeting.snapshot` al ser admitido desde la
   * sala de espera. Idempotente (el snapshot del admit re-concilia la lista). Decide Mesh vs SFU (no soportado).
   */
  private applySnapshot(snap: MeetingSnapshotDto): void {
    if (snap.meetingId !== this.meetingId()) {
      return;
    }
    this.strategy.set(snap.strategy);
    this.conversationId.set(snap.conversationId);
    if (snap.conversationId && !this.chatHistoryLoaded) {
      this.chatHistoryLoaded = true;
      this.loadChatHistory(snap.conversationId);
    }
    this.yourRole.set(snap.yourRole);
    this.isLocked.set(snap.isLocked);
    this.participants.set(snap.participants);
    this.phase.set('joined');

    if (snap.strategy === 'Sfu') {
      void this.startSfu(); // >4: media por mediasoup (no mesh)
      return;
    }
    // Mesh: conectar con cada participante presente y depurar los ausentes (idempotente).
    this.reconcileMeshPeers(snap.participants);
  }

  /** Upsert/baja de un participante según el contrato real (`status`). */
  private applyParticipantChange(participant: MeetingParticipantDto): void {
    this.participants.update(list => {
      const rest = list.filter(p => p.userId !== participant.userId);
      if (participant.status === 'Left' || participant.status === 'Removed') {
        return rest;
      }
      return [...rest, participant].sort((a, b) => a.joinOrder - b.joinOrder);
    });
  }

  async join(meetingId: string, title: string): Promise<void> {
    if (this.phase() !== 'idle') {
      return;
    }
    this.bindListenersOnce();
    this.errorMessage.set(null);
    this.meetingId.set(meetingId);
    this.meetingTitle.set(title);
    this.myUserId.set(this.auth.currentUser()?.id ?? null);
    this.participants.set([]);
    this.peers.set(new Map());
    this.audioEnabled.set(true);
    this.videoEnabled.set(true);
    this.handRaised.set(false);
    this.phase.set('joining');

    try {
      const ice = await firstValueFrom(this.calls.getIceServers());
      this.iceServers = ice.iceServers;
    } catch {
      this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }

    // Media: cámara+mic; si la cámara está ocupada (típico en pruebas locales con 2 pestañas) se cae a
    // solo-audio; y SIEMPRE se asegura una pista de video (placeholder negro deshabilitado) para que el
    // m-line de video exista desde el join, creado UNA sola vez. Así prender cámara / compartir pantalla
    // es un replaceTrack SIN renegociar — evita el bug de Chromium "BUNDLE codec collision for header
    // extension id" y el screen-share remoto que no llegaba (porque creaba el m-line de video tarde).
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.videoEnabled.set(false);
      } catch {
        this.videoEnabled.set(false);
        this.audioEnabled.set(false);
        this.errorMessage.set('Could not access your camera/microphone.');
      }
    }
    this.cameraTrack = stream?.getVideoTracks()[0] ?? null;
    if (!this.cameraTrack) {
      // Placeholder negro para tener el m-line de video aunque no haya cámara (creado una vez). En un
      // entorno sin soporte de media (jsdom en tests) canvas.captureStream/MediaStream no existen → se
      // ignora y se sigue sin video, igual que antes.
      try {
        const placeholder = this.ensurePlaceholderVideoTrack();
        if (stream) {
          stream.addTrack(placeholder);
        } else {
          stream = new MediaStream([placeholder]);
        }
      } catch {
        /* sin soporte de media (tests): sin placeholder */
      }
      this.videoEnabled.set(false);
    }
    this.localStream.set(stream);

    await this.attemptJoin();
  }

  /**
   * Un intento de `meeting.join` (con o sin passcode). Si el meeting exige passcode y no se dio / es
   * incorrecto, el backend responde `Meeting.InvalidPasscode`: en vez de tirar un error genérico, se
   * pasa a la fase `passcode` para que el room muestre el prompt y el usuario reintente con el código.
   */
  private async attemptJoin(passcode?: string): Promise<void> {
    const meetingId = this.meetingId();
    if (!meetingId) {
      return;
    }
    this.phase.set('joining');
    try {
      const ack = await this.rtc.join(meetingId, passcode ? { passcode } : undefined);
      this.errorMessage.set(null);
      if (ack.requiresAdmission) {
        // Al admitirnos, el backend emite `meeting.snapshot` → applySnapshot pone 'joined'/'unsupported'.
        this.phase.set('waiting');
      } else {
        // Join directo: el snapshot NO llega por evento, viene inline en el ack. Sin esto el CRM
        // quedaba colgado en 'joining' esperando un `meeting.snapshot` que nunca se emitía.
        this.applySnapshot(ack.snapshot);
      }
    } catch (err) {
      if ((err as { code?: string }).code === 'Meeting.InvalidPasscode') {
        this.errorMessage.set(passcode ? 'Wrong passcode. Please try again.' : null);
        this.phase.set('passcode');
        return;
      }
      this.errorMessage.set('Could not join the meeting.');
      this.reset();
    }
  }

  /** El usuario ingresó el passcode en el prompt: reintentar el join con él. */
  async submitPasscode(passcode: string): Promise<void> {
    const code = passcode.trim();
    if (!code || this.phase() !== 'passcode') {
      return;
    }
    await this.attemptJoin(code);
  }

  /**
   * Reconnect transparente del socket a mitad de meeting: re-une la room `m:` (backend) y reconcilia
   * el roster con el snapshot del ack. NO toca la media viva ni el conversationId (se conserva); si el
   * mesh quedó incompleto durante el corte, `reconcileMeshPeers` re-conecta a los peers faltantes.
   */
  private async handleSocketReconnected(): Promise<void> {
    const id = this.meetingId();
    if (!id || this.phase() !== 'joined') {
      return; // solo re-unimos si estábamos DENTRO (no en sala de espera, idle ni ended)
    }
    try {
      const { snapshot } = await this.rtc.rejoin(id);
      if (snapshot.meetingId !== this.meetingId()) {
        return;
      }
      this.yourRole.set(snapshot.yourRole);
      this.isLocked.set(snapshot.isLocked);
      this.participants.set(snapshot.participants);
      this.reconcileMeshPeers(snapshot.participants);
    } catch {
      // Best-effort: si el rejoin falla (ya no sos participante / meeting terminó), no rompemos el
      // estado local; el próximo evento o una recarga lo resuelven.
    }
  }

  /** Conecta a los peers Joined que falten y depura los ausentes (idempotente). No-op en SFU. */
  private reconcileMeshPeers(participants: MeetingParticipantDto[]): void {
    if (this.strategy() === 'Sfu') {
      return;
    }
    const myId = this.myUserId();
    participants.filter(p => p.status === 'Joined' && p.userId !== myId).forEach(p => this.connectToPeer(p.userId));
    const present = new Set(participants.map(p => p.userId));
    [...this.peerConns.keys()].filter(id => !present.has(id)).forEach(id => this.disconnectFromPeer(id));
  }

  // ---------- Mesh WebRTC (perfect negotiation por peer) ----------

  private connectToPeer(peerUserId: string): void {
    if (this.peerConns.has(peerUserId)) {
      return; // idempotente
    }
    const myId = this.myUserId();
    if (!myId || peerUserId === myId) {
      return;
    }
    const pc = new RTCPeerConnection({ iceServers: this.iceServers as RTCIceServer[] });
    // Polite/impolite DETERMINISTA por userId: ambos lados calculan la misma relación,
    // así el glare (los dos ofertan al agregar tracks) se resuelve sin doble-oferta.
    const conn: PeerConn = {
      pc,
      isPolite: myId < peerUserId,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      videoSender: null,
    };
    this.peerConns.set(peerUserId, conn);

    const remote = new MediaStream();
    this.peers.update(map => {
      const next = new Map(map);
      next.set(peerUserId, { userId: peerUserId, stream: remote });
      return next;
    });

    // Se agregan las pistas con addTrack (NO addTransceiver: dispara un bug de Chromium reciente,
    // "BUNDLE codec collision for header extension id"). Se guarda el sender de video para poder
    // prender/apagar/compartir con replaceTrack sin renegociar. Apagar la cámara = replaceTrack(null) +
    // detener la pista (LED off). Si me conecto con la cámara apagada no hay sender aún → applyVideoTrack
    // hace addTrack la primera vez (renegociación limpia de un solo lado; con el patrón MDN el ICE va bien).
    const stream = this.localStream();
    stream?.getTracks().forEach(track => {
      const sender = pc.addTrack(track, stream);
      if (track.kind === 'video') {
        conn.videoSender = sender;
      }
    });

    pc.ontrack = event => remote.addTrack(event.track);
    pc.onicecandidate = event => {
      if (event.candidate) {
        this.rtc.signal(this.meetingId()!, peerUserId, 'ice', event.candidate.toJSON() as unknown as Record<string, unknown>);
      }
    };
    pc.onnegotiationneeded = async () => {
      try {
        conn.makingOffer = true;
        await pc.setLocalDescription();
        this.rtc.signal(this.meetingId()!, peerUserId, 'offer', pc.localDescription as unknown as Record<string, unknown>);
      } catch (err) {
        console.error('[ActiveMeeting] negotiationneeded error:', err);
      } finally {
        conn.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.disconnectFromPeer(peerUserId);
      }
    };
  }

  private async handleSignal(fromPeerUserId: string, kind: 'offer' | 'answer' | 'ice', data: unknown): Promise<void> {
    if (!this.peerConns.has(fromPeerUserId)) {
      this.connectToPeer(fromPeerUserId);
    }
    const conn = this.peerConns.get(fromPeerUserId);
    if (!conn) {
      return;
    }
    const pc = conn.pc;
    try {
      if (kind === 'offer' || kind === 'answer') {
        const description = data as RTCSessionDescriptionInit;
        // Colisión de ofertas (glare), patrón MDN: el impolite ignora el offer entrante; el polite lo
        // acepta (rollback implícito). `isSettingRemoteAnswerPending` cubre la ventana async entre
        // aceptar un answer y que quede aplicado, para no marcar colisión de más.
        const readyForOffer =
          !conn.makingOffer && (pc.signalingState === 'stable' || conn.isSettingRemoteAnswerPending);
        const offerCollision = kind === 'offer' && !readyForOffer;
        conn.ignoreOffer = !conn.isPolite && offerCollision;
        if (conn.ignoreOffer) {
          return;
        }
        conn.isSettingRemoteAnswerPending = kind === 'answer';
        await pc.setRemoteDescription(description);
        conn.isSettingRemoteAnswerPending = false;
        if (kind === 'offer') {
          await pc.setLocalDescription();
          this.rtc.signal(this.meetingId()!, fromPeerUserId, 'answer', pc.localDescription as unknown as Record<string, unknown>);
        }
      } else if (kind === 'ice') {
        // SIN buffer manual: el RTCPeerConnection encola addIceCandidate detrás de setRemoteDescription.
        // Los errores acá son INOFENSIVOS y esperados con glare: candidatos de una generación de oferta
        // vieja/ignorada ("Unknown ufrag") o que llegan antes de que ese lado tenga remoteDescription
        // (offer ignorado → "remote description was null"). Los candidatos de la generación buena SÍ se
        // aplican y el ICE completa — se ignoran en silencio para no ensuciar la consola ni alarmar.
        try {
          await pc.addIceCandidate(data as RTCIceCandidateInit);
        } catch {
          /* candidato obsoleto por glare — inofensivo */
        }
      }
    } catch (err) {
      console.error('[ActiveMeeting] signal handling error:', err);
    }
  }

  private disconnectFromPeer(peerUserId: string): void {
    this.peerConns.get(peerUserId)?.pc.close();
    this.peerConns.delete(peerUserId);
    this.peers.update(map => {
      if (!map.has(peerUserId)) {
        return map;
      }
      const next = new Map(map);
      next.delete(peerUserId);
      return next;
    });
  }

  // ---------- SFU (>4 participantes) ----------

  private async startSfu(): Promise<void> {
    const meetingId = this.meetingId();
    if (!meetingId) {
      return;
    }
    const ok = await this.sfu.join(meetingId, this.localStream(), {
      onRemoteStream: (userId, stream) => this.setSfuPeer(userId, stream),
      onRemovePeer: userId => this.disconnectFromPeer(userId),
    });
    if (!ok) {
      // El SFU no pudo arrancar (device/transport): degradar con mensaje claro.
      this.phase.set('unsupported');
    }
  }

  private setSfuPeer(userId: string, stream: MediaStream): void {
    this.peers.update(map => {
      const next = new Map(map);
      next.set(userId, { userId, stream });
      return next;
    });
  }

  // ---------- Controles de media ----------

  /**
   * Pista de video "vacía": un canvas 2×2 negro capturado a 1 fps y DESHABILITADO (no transmite). Sirve
   * para que el m-line/sender de video exista aunque no haya cámara, y así prender la cámara o compartir
   * pantalla sea un `replaceTrack` (sin crear el m-line tarde, que disparaba el bug de Chromium y dejaba
   * el screen share sin llegar al remoto). Se crea una vez y se reusa.
   */
  private ensurePlaceholderVideoTrack(): MediaStreamTrack {
    const existing = this.placeholderStream?.getVideoTracks()[0];
    if (existing && existing.readyState === 'live') {
      return existing;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    canvas.getContext('2d')?.fillRect(0, 0, 2, 2);
    this.placeholderStream = (
      canvas as HTMLCanvasElement & { captureStream(frameRate?: number): MediaStream }
    ).captureStream(1);
    const track = this.placeholderStream.getVideoTracks()[0];
    track.enabled = false;
    return track;
  }

  toggleAudio(): void {
    const enabled = !this.audioEnabled();
    this.audioEnabled.set(enabled);
    this.localStream()
      ?.getAudioTracks()
      .forEach(t => (t.enabled = enabled));
    this.publishMediaStatus();
  }

  async toggleVideo(): Promise<void> {
    const enabling = !this.videoEnabled();

    // Compartiendo pantalla: la pista de "video" es la pantalla, no la cámara — el toggle solo cambia
    // el flag (no toca la cámara ni el sender).
    if (this.screenSharing()) {
      this.videoEnabled.set(enabling);
      this.publishMediaStatus();
      return;
    }

    if (!enabling) {
      // Apagar de VERDAD: DETENER la pista de cámara apaga el hardware/LED de la PC (no basta `enabled=false`,
      // que la deja adquirida). Se pone el placeholder negro (deshabilitado, no transmite) en el stream y en
      // los peers con replaceTrack — mantiene el m-line de video vivo, así que NO hay renegociación.
      const placeholder = this.ensurePlaceholderVideoTrack();
      this.localStream()
        ?.getVideoTracks()
        .forEach(t => {
          if (t !== placeholder) {
            t.stop();
          }
        });
      this.swapLocalVideoTrack(placeholder);
      await this.applyVideoTrack(placeholder);
      this.cameraTrack = null;
      this.videoEnabled.set(false);
      this.publishMediaStatus();
      return;
    }

    // Encender: adquirir la cámara y publicarla con replaceTrack sobre el sender persistente (sin renegociar).
    let cam: MediaStream;
    try {
      cam = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch {
      this.videoEnabled.set(false); // sin permiso: no marcar como encendida
      return;
    }
    const track = cam.getVideoTracks()[0] ?? null;
    if (track) {
      this.cameraTrack = track;
      await this.applyVideoTrack(track);
      this.swapLocalVideoTrack(track);
    }
    this.videoEnabled.set(true);
    this.publishMediaStatus();
  }

  toggleHandRaise(): void {
    const meetingId = this.meetingId();
    if (!meetingId) {
      return;
    }
    const raised = !this.handRaised();
    this.handRaised.set(raised);
    this.rtc.raiseHand(meetingId, raised);
  }

  private publishMediaStatus(): void {
    const meetingId = this.meetingId();
    if (meetingId) {
      this.rtc.mediaStatus(meetingId, this.audioEnabled(), this.videoEnabled(), this.screenSharing());
    }
  }

  /**
   * Pide la capa de simulcast de un peer (solo SFU; no-op en mesh). Lo usa el driver de "spotlight" del
   * meeting-room: tile destacado = alta (spatial 2), thumbnails = baja (spatial 0). Fire-and-forget.
   */
  setPeerPreferredLayers(userId: string, spatialLayer: number, temporalLayer?: number): void {
    if (this.strategy() !== 'Sfu') {
      return;
    }
    void this.sfu.setPeerPreferredLayers(userId, spatialLayer, temporalLayer);
  }

  // ---------- Screen share (replaceTrack por peer, sin renegociar) ----------

  async startScreenShare(): Promise<void> {
    const meetingId = this.meetingId();
    if (!meetingId || this.phase() !== 'joined' || this.screenSharing()) {
      return;
    }
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch {
      return; // el usuario canceló el selector
    }
    const track = display.getVideoTracks()[0];
    if (!track) {
      return;
    }
    this.screenTrack = track;
    await this.applyVideoTrack(track); // a cada peer (mesh) o al producer (SFU), sin renegociar
    // Y en el localStream: así el PiP local muestra la pantalla y los peers NUEVOS también la reciben.
    this.swapLocalVideoTrack(track);
    track.onended = () => void this.stopScreenShare();
    this.screenSharing.set(true);
    this.publishMediaStatus();
  }

  async stopScreenShare(): Promise<void> {
    if (!this.screenSharing()) {
      return;
    }
    this.screenTrack?.stop();
    this.screenTrack = null;
    // Restaurar la cámara si estaba encendida; si no, el placeholder (mantiene el m-line vivo).
    const restore = this.cameraTrack ?? this.ensurePlaceholderVideoTrack();
    await this.applyVideoTrack(restore);
    this.swapLocalVideoTrack(restore);
    this.screenSharing.set(false);
    this.publishMediaStatus();
  }

  /** Aplica el track de video actual (cámara/pantalla) a los peers: mesh = replaceTrack por peer; SFU = producer. */
  private async applyVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    if (this.strategy() === 'Sfu') {
      await this.sfu.replaceVideoTrack(track);
      return;
    }
    // Con sender de video ya creado: replaceTrack (prender/apagar/compartir SIN renegociar). `track=null`
    // corta la cámara; un track nuevo prende o comparte pantalla. Si aún no hay sender (me conecté con la
    // cámara apagada), addTrack la primera vez — renegociación limpia de un solo lado.
    const stream = this.localStream();
    for (const conn of this.peerConns.values()) {
      if (conn.videoSender) {
        await conn.videoSender.replaceTrack(track);
      } else if (track && stream) {
        conn.videoSender = conn.pc.addTrack(track, stream);
      }
    }
  }

  /** Deja en el localStream (preview) solo el track de video indicado — sin detener la cámara. */
  private swapLocalVideoTrack(track: MediaStreamTrack | null): void {
    const stream = this.localStream();
    if (!stream) {
      return;
    }
    stream.getVideoTracks().forEach(t => {
      if (t !== track) {
        stream.removeTrack(t); // removeTrack NO detiene la cámara (se restaura luego)
      }
    });
    if (track && !stream.getVideoTracks().includes(track)) {
      stream.addTrack(track);
    }
  }

  private toChatView(dto: MeetingChatMessageDto): MeetingChatMessage {
    const myId = this.myUserId();
    return {
      id: dto.id,
      senderName: dto.senderDisplayName,
      text: dto.isDeleted ? '(message deleted)' : (dto.body ?? ''),
      time: new Date(dto.createdAtUtc).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      isMine: !!myId && dto.senderId === myId,
    };
  }

  /** Carga el historial previo del chat del meeting (el backend pagina DESC → se invierte a ASC). */
  private loadChatHistory(conversationId: string): void {
    const url = this.api.tenantUrl(`/communication/conversations/${conversationId}/messages`);
    this.http
      .get<{ items: MeetingChatMessageDto[] }>(url, { params: new HttpParams().set('take', 50) })
      .subscribe({
        next: page => {
          const history = [...page.items].reverse().map(dto => this.toChatView(dto)); // DESC→ASC
          this.chatMessages.update(live => {
            const liveIds = new Set(live.map(m => m.id));
            const olderNew = history.filter(m => !liveIds.has(m.id));
            return [...olderNew, ...live]; // historial (más viejo) antes de lo que llegó en vivo
          });
        },
        error: () => undefined, // sin historial no es bloqueante
      });
  }

  /** Envía un mensaje al chat del meeting. La UI se actualiza con el broadcast `meeting.chat.message.new`. */
  sendChatMessage(body: string): void {
    const meetingId = this.meetingId();
    const trimmed = body.trim();
    if (!meetingId || !trimmed) {
      return;
    }
    this.rtc.chatSend(meetingId, trimmed).catch(() => this.toast.error('Message could not be sent.'));
  }

  // ---------- Grabación (con consentimiento) ----------

  requestRecording(): void {
    const meetingId = this.meetingId();
    if (!meetingId || this.phase() !== 'joined' || this.recordingState() !== 'Idle') {
      return;
    }
    this.rtc.requestRecording(meetingId).catch(() => this.toast.error('Could not start recording.'));
  }

  respondRecordingConsent(accepted: boolean): void {
    const meetingId = this.meetingId();
    this.recordingConsentFrom.set(null);
    if (meetingId) {
      this.rtc.respondRecordingConsent(meetingId, accepted ? 'Accepted' : 'Rejected').catch(() => undefined);
    }
  }

  async stopRecording(): Promise<void> {
    const meetingId = this.meetingId();
    if (!meetingId || !this.isRecordingRequester() || this.recordingState() !== 'Recording') {
      return;
    }
    try {
      await this.rtc.stopRecording(meetingId);
    } catch {
      /* noop */
    }
    const blob = await this.recording.stop();
    if (blob) {
      void this.uploadAndAttach(meetingId, blob);
    }
  }

  private finalizeRecordingBackground(): void {
    if (!this.isRecordingRequester()) {
      return;
    }
    const meetingId = this.meetingId();
    if (!meetingId) {
      return;
    }
    void this.recording.stop().then(blob => {
      if (blob && blob.size > 0) {
        void this.uploadAndAttach(meetingId, blob);
      }
    });
  }

  private async uploadAndAttach(meetingId: string, blob: Blob): Promise<void> {
    if (blob.size === 0) {
      return;
    }
    const file = new File([blob], `meeting-recording-${meetingId}.webm`, { type: 'audio/webm' });
    const request: InitiateUploadRequest = {
      originalName: file.name,
      contentType: 'audio/webm',
      sizeBytes: file.size,
      ownerType: 'Communication',
      ownerId: meetingId,
      // La grabación (audio mezclado, audio/webm) va a la carpeta Recordings — OtherPolicy no admite
      // audio/* y devolvía 400 ("Could not save the recording"). RecordingsPolicy acepta audio/webm.
      folderType: 'Recordings',
      taxYear: null,
    };
    // Paso 1: subir a CloudStorage. Si esto falla, la grabación se perdió → toast de error.
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
    // Paso 2: enlazar el fileId al meeting. El archivo YA está guardado; el attach puede perder la carrera
    // con el fin del meeting. Idempotente → un reintento; si aun así falla NO se muestra error.
    try {
      await this.rtc.attachRecording(meetingId, fileId);
    } catch {
      try {
        await this.rtc.attachRecording(meetingId, fileId);
      } catch {
        /* la grabación quedó guardada; sin toast de error. */
      }
    }
  }

  // ---------- Host controls (el backend valida Host/Cohost; la UI los muestra solo al host) ----------

  admit(targetUserId: string): void {
    this.hostAction(id => this.rtc.admit(id, targetUserId));
  }
  deny(targetUserId: string): void {
    this.hostAction(id => this.rtc.deny(id, targetUserId));
  }
  removeParticipant(targetUserId: string): void {
    this.hostAction(id => this.rtc.remove(id, targetUserId));
  }
  toggleLock(): void {
    const locked = !this.isLocked();
    this.hostAction(id => this.rtc.lock(id, locked));
  }
  muteAll(): void {
    this.hostAction(id => this.rtc.muteAll(id));
  }
  transferHost(targetUserId: string): void {
    this.hostAction(id => this.rtc.transferHost(id, targetUserId));
  }
  promoteCohost(targetUserId: string): void {
    this.hostAction(id => this.rtc.promoteCohost(id, targetUserId));
  }
  demoteCohost(targetUserId: string): void {
    this.hostAction(id => this.rtc.demoteCohost(id, targetUserId));
  }

  /** El estado real (lock/roles/admisión) llega por snapshot/participant.changed; acá solo se dispara y se surface el error. */
  private hostAction(run: (meetingId: string) => Promise<unknown>): void {
    const meetingId = this.meetingId();
    if (!meetingId) {
      return;
    }
    run(meetingId).catch(() => this.toast.error('That action could not be completed.'));
  }

  async leave(): Promise<void> {
    const meetingId = this.meetingId();
    // Si estoy grabando, capturo el blob ANTES de cortar los tracks (la subida va en background).
    let pendingBlob: Blob | null = null;
    if (this.isRecordingRequester() && this.recordingState() === 'Recording') {
      if (meetingId) {
        try {
          await this.rtc.stopRecording(meetingId);
        } catch {
          /* noop */
        }
      }
      pendingBlob = await this.recording.stop();
    }
    if (meetingId) {
      try {
        await this.rtc.leave(meetingId);
      } catch {
        /* noop */
      }
    }
    if (pendingBlob && meetingId) {
      void this.uploadAndAttach(meetingId, pendingBlob);
    }
    this.reset();
  }

  /**
   * Apaga la cámara/micrófono (libera el hardware) + cierra los peer connections/SFU, SIN tocar el
   * resto del estado ni la fase. Se llama cuando el meeting termina por EVENTO (Ended/Cancelled/Denied)
   * para que la cámara no quede encendida mientras se muestra la pantalla de "terminado" — antes el CRM
   * solo ponía phase='ended' y la cámara seguía prendida. `reset()` lo repite al cerrar del todo (idempotente).
   */
  private stopLocalMedia(): void {
    this.sfu.leave();
    this.peerConns.forEach(conn => conn.pc.close());
    this.peerConns.clear();
    this.peers.set(new Map());
    this.screenTrack?.stop();
    this.screenTrack = null;
    // cameraTrack puede estar FUERA del localStream (durante screenshare se guarda aparte para
    // restaurar) — detenerla explícitamente, no solo nulificarla, o la cámara queda encendida.
    this.cameraTrack?.stop();
    this.cameraTrack = null;
    this.localStream()
      ?.getTracks()
      .forEach(t => t.stop());
    this.localStream.set(null);
    this.placeholderStream?.getTracks().forEach(t => t.stop());
    this.placeholderStream = null;
    this.screenSharing.set(false);
  }

  private reset(): void {
    // Fin abrupto (meeting terminó, me sacaron) mientras grababa: rescatar lo grabado.
    this.finalizeRecordingBackground();
    this.stopLocalMedia();
    this.chatMessages.set([]);
    this.chatHistoryLoaded = false;
    this.iceServers = [];
    this.phase.set('idle');
    this.meetingId.set(null);
    this.meetingTitle.set('');
    this.conversationId.set(null);
    this.participants.set([]);
    this.yourRole.set('Attendee');
    this.strategy.set('Mesh');
    this.isLocked.set(false);
    this.audioEnabled.set(true);
    this.videoEnabled.set(true);
    this.handRaised.set(false);
    this.recordingState.set('Idle');
    this.stopRecordingTimer();
    this.recordingConsentFrom.set(null);
    this._recordingRequesterId.set(null);
    this.myUserId.set(null);
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
