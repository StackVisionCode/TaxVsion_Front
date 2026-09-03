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
import { MeetingParticipantDto, MeetingRecordingState, MeetingRole, MeetingStrategy } from './meeting.model';

export type ActiveMeetingPhase = 'idle' | 'joining' | 'waiting' | 'joined' | 'unsupported' | 'ended';

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

/** Estado de negociación por peer (perfect negotiation + buffer de ICE). */
interface PeerConn {
  pc: RTCPeerConnection;
  isPolite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
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
  private chatHistoryLoaded = false;
  private listenersBound = false;

  private bindListenersOnce(): void {
    if (this.listenersBound) {
      return;
    }
    this.listenersBound = true;

    // El snapshot es la señal autoritativa de "ya estás dentro": trae strategy, participantes,
    // tu rol y el conversationId. Acá se decide Mesh (soportado) vs SFU (no soportado aún).
    this.rtc.onSnapshot().subscribe(snap => {
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
    });

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
      if (dto.state === 'Recording' && this.isRecordingRequester()) {
        const streams = [this.localStream(), ...[...this.peers().values()].map(p => p.stream)];
        this.recording.start(...streams);
      } else if (dto.state === 'Failed') {
        this.toast.error('The recording failed.');
      } else if (dto.state === 'Idle') {
        this.recordingConsentFrom.set(null);
        this._recordingRequesterId.set(null);
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
    });

    this.rtc.onCancelled().subscribe(dto => {
      if (dto.meetingId !== this.meetingId()) {
        return;
      }
      this.errorMessage.set('This meeting was cancelled.');
      this.phase.set('ended');
    });
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

    // A diferencia de una llamada 1:1, si falla getUserMedia igual entrás al meeting
    // (podés ver/oír a los demás); tu tile muestra el avatar.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      this.localStream.set(stream);
      this.cameraTrack = stream.getVideoTracks()[0] ?? null;
    } catch {
      this.errorMessage.set('Could not access your camera/microphone.');
      this.videoEnabled.set(false);
      this.audioEnabled.set(false);
    }

    try {
      const ack = await this.rtc.join(meetingId);
      if (ack.requiresAdmission) {
        this.phase.set('waiting');
      }
      // Si no requiere admisión, el `meeting.snapshot` (que llega enseguida) pone 'joined'/'unsupported'.
    } catch {
      this.errorMessage.set('Could not join the meeting.');
      this.reset();
    }
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
    const conn: PeerConn = { pc, isPolite: myId < peerUserId, makingOffer: false, ignoreOffer: false, pendingCandidates: [] };
    this.peerConns.set(peerUserId, conn);

    const remote = new MediaStream();
    this.peers.update(map => {
      const next = new Map(map);
      next.set(peerUserId, { userId: peerUserId, stream: remote });
      return next;
    });

    this.localStream()
      ?.getTracks()
      .forEach(track => pc.addTrack(track, this.localStream()!));

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
      if (kind === 'offer') {
        const offerCollision = conn.makingOffer || pc.signalingState !== 'stable';
        conn.ignoreOffer = !conn.isPolite && offerCollision;
        if (conn.ignoreOffer) {
          return;
        }
        await pc.setRemoteDescription(data as RTCSessionDescriptionInit);
        await this.flushPendingCandidates(conn);
        await pc.setLocalDescription();
        this.rtc.signal(this.meetingId()!, fromPeerUserId, 'answer', pc.localDescription as unknown as Record<string, unknown>);
      } else if (kind === 'answer') {
        await pc.setRemoteDescription(data as RTCSessionDescriptionInit);
        await this.flushPendingCandidates(conn);
      } else if (kind === 'ice') {
        const candidate = data as RTCIceCandidateInit;
        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidate);
        } else {
          conn.pendingCandidates.push(candidate); // llegó antes del remote description
        }
      }
    } catch (err) {
      if (!conn.ignoreOffer) {
        console.error('[ActiveMeeting] signal handling error:', err);
      }
    }
  }

  private async flushPendingCandidates(conn: PeerConn): Promise<void> {
    const pending = conn.pendingCandidates;
    conn.pendingCandidates = [];
    for (const candidate of pending) {
      try {
        await conn.pc.addIceCandidate(candidate);
      } catch (err) {
        console.error('[ActiveMeeting] buffered ICE candidate error:', err);
      }
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
    await this.applyVideoTrack(this.cameraTrack ?? null); // restaurar cámara (o cortar) en mesh/SFU
    this.swapLocalVideoTrack(this.cameraTrack ?? null);
    this.screenSharing.set(false);
    this.publishMediaStatus();
  }

  /** Aplica el track de video actual (cámara/pantalla) a los peers: mesh = replaceTrack por peer; SFU = producer. */
  private async applyVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    if (this.strategy() === 'Sfu') {
      await this.sfu.replaceVideoTrack(track);
      return;
    }
    for (const conn of this.peerConns.values()) {
      const sender = conn.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(track);
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
      folderType: 'Other',
      taxYear: null,
    };
    try {
      const fileId = await firstValueFrom(
        this.cloudStorage.initiateUpload(request).pipe(
          switchMap(init =>
            this.cloudStorage.uploadToPresignedUrl(init.uploadUrl, init.formData, file).pipe(
              switchMap(() => this.cloudStorage.completeUpload(init.fileId)),
              map(() => init.fileId),
            ),
          ),
        ),
      );
      await this.rtc.attachRecording(meetingId, fileId);
    } catch {
      this.toast.error('Could not save the recording.');
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

  private reset(): void {
    // Fin abrupto (meeting terminó, me sacaron) mientras grababa: rescatar lo grabado.
    this.finalizeRecordingBackground();
    this.sfu.leave();
    this.peerConns.forEach(conn => conn.pc.close());
    this.peerConns.clear();
    this.peers.set(new Map());
    this.chatMessages.set([]);
    this.chatHistoryLoaded = false;
    this.screenTrack?.stop();
    this.screenTrack = null;
    this.cameraTrack = null;
    this.localStream()
      ?.getTracks()
      .forEach(t => t.stop());
    this.localStream.set(null);
    this.iceServers = [];
    this.screenSharing.set(false);
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
    this.recordingConsentFrom.set(null);
    this._recordingRequesterId.set(null);
    this.myUserId.set(null);
  }
}
