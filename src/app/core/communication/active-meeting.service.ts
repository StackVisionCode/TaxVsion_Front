import { applyReaction, hasMyReaction, reactionErrorText } from '@shared/ui/chat/message-reactions/reaction-summary';
import { toAttachmentScanState, type AttachmentScanState, type MessageReactionSummary } from '@shared/ui/chat/chat-message.model';
import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { ApiConfigService } from '@core/config/api-config.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { toApiError } from '@core/models/api-error.model';
import { SOCKET_RATE_LIMITED_MESSAGE, isSocketRateLimited, socketErrorCode } from '@core/errors/throttling';
import { MeetingChatMessageDto } from './meeting.model';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { formatBytes } from '@core/cloud-storage/cloud-storage.model';
import { editErrorMessage, type ChatEditPolicy } from '@shared/ui/chat/message-edit';
import { meetingChatErrorMessage } from './meeting-chat-errors';
import { MeetingRtcService } from './meeting-rtc.service';
import { MeetingSfuService, SfuProducerKey } from './meeting-sfu.service';
import { CallsService } from './calls.service';
import { ActiveCallService } from './active-call.service';
import { IceServer } from './call.model';
import {
  MeetingDurationWarningDto,
  MeetingEndReason,
  MeetingParticipantDto,
  MeetingRecordingState,
  MeetingRecordingStateChangedDto,
  MeetingRole,
  MeetingSnapshotDto,
  MeetingStrategy,
  MeetingYouRemovedReason,
} from './meeting.model';

import { ActiveMeetingPhase, MeetingSessionState } from './meeting-session-state';
import { applyProfileChangeToRoster, mergeMeetingParticipant, mergeMeetingRoster, sortRaisedHands } from './meeting-participants.util';
import {
  MeetingReaction,
  addReaction,
  handErrorMessage,
  latestReactionByUser,
  pruneReactions,
  reactionErrorMessage,
  receivedAtMs,
} from './meeting-reactions.util';
import { SpeakingThrottle } from './active-speaker.util';
import { MediaLinkState, aggregateMediaState } from './ice-recovery-policy';
import {
  MS_PER_SECOND,
  formatClock,
  hostActionErrorMessage,
  meetingEndedMessage,
  remainingSecondsAt,
  youRemovedMessage,
} from './meeting-clock.util';
import { SessionTeardownRegistry } from '@core/auth/session-teardown';
import { MediaPolicyService } from './media/media-policy.service';
import { ConnectionQuality, MediaPolicyDto } from './media/media-policy.model';
import { LocalMediaSessionFactory } from './media/local-media-session.factory';
import { LocalMediaSession, LocalTrackSource, MuteReason } from './media/local-media-session';
import { MediaAccessError } from './media/media-errors';
import { PeerConnectionFactory, PeerLink, PeerSignalKind } from './media/peer-connection-factory';
import { QualityMonitor } from './media/quality-monitor';
import { QualityMetrics } from './media/derive-quality';
import { EchoDetector } from './media/echo-detector';
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

/** Fases en las que seguimos "dentro" para el servidor (hay una room que abandonar). */
const IN_MEETING_PHASES: readonly ActiveMeetingPhase[] = ['joining', 'waiting', 'passcode', 'joined'];
const CLOCK_TICK_MS = MS_PER_SECOND;
/** Cada cuánto avanza el cronómetro "REC 0:12". */
const RECORDING_TICK_MS = 250;
/** Mesh con esta cantidad de participantes (incluido yo) o más → perfil de cámara reducido (`meshCamera`). */
const MESH_REDUCED_PROFILE_FROM = 3;
/** Copy del aviso de eco (D-51). */
const ECHO_NOTICE = "We're detecting echo from your side. Use headphones or lower your speaker volume.";
/** Capa espacial completa del simulcast de cámara (0 = ¼, 1 = ½, 2 = completa). */
const TOP_SPATIAL_LAYER = 2;
/** Cada cuánto se barren las reacciones vencidas (la duración la da la política). */
const REACTION_SWEEP_MS = 250;

/** F5 — acciones de host que ofrece el menú del tile y el panel de participantes. */
export type MeetingHostTileAction = 'promote' | 'demote' | 'makeHost' | 'lowerHand' | 'remove' | 'admit' | 'deny';

// Re-export: el tipo vive en meeting-session-state (liviano, usado por el shell).
export type { ActiveMeetingPhase };

/** Mensaje del chat del meeting, ya en shape de vista. */
export interface MeetingChatMessage {
  id: string;
  senderName: string;
  text: string;
  time: string;
  isMine: boolean;
  /** F8a: lo que necesita el hilo compartido (T-11) de la sala. */
  senderUserId: string;
  createdAtUtc: string;
  isEdited: boolean;
  editCount: number;
  isDeleted: boolean;
  /** T-20: `status` solo cuando la moderación lo retuvo (en revisión o bloqueado). */
  attachment?: { fileId: string; name: string; size: string; status?: AttachmentScanState };
  /** F8d (T-26): reacciones del mensaje. */
  reactions?: MessageReactionSummary[];
}

/**
 * Un peer remoto con DOS streams separados: cámara (+ su audio) y pantalla (+ su audio). Un
 * participante puede enviar ambos a la vez, así que se mantienen aparte para pintar la cámara en su
 * tile y la pantalla en el escenario. `screenStream` puede estar "vacío" (placeholder) mientras el
 * peer no comparte; la UI lo muestra solo cuando su flag `screenSharing` está activo.
 */
export interface MeetingPeer {
  userId: string;
  cameraStream: MediaStream;
  screenStream: MediaStream;
}

/** Opciones de entrada (lobby): si faltan, mandan las preferencias del usuario (`joinMuted`/`joinCameraOff`). */
export interface MeetingJoinMediaOptions {
  audio?: boolean;
  video?: boolean;
}

/** Enlace mesh con un peer + el joinOrder con el que se armó (para detectar un RE-JOIN y rearmar). */
interface PeerConn {
  link: PeerLink;
  joinOrder: number | undefined;
}

/**
 * Orquestador de la sesión de meeting activa: join / sala de espera / passcode, snapshot, roster y
 * rol reactivo (F3), reloj y fin, chat, grabación con consentimiento, host actions, mesh (perfect
 * negotiation por peer) o SFU según `strategy`, y ciclo de vida de la pestaña.
 *
 * F4: NO toca media ni RTCPeerConnection directamente. La captura vive en `LocalMediaSession`, cada
 * enlace mesh en `PeerLink` (fábrica), el SFU en `MeetingSfuService` (encodings de la política), la
 * calidad en `QualityMonitor` (T-48, D-39) con modo solo audio automático (D-40), el eco en
 * `EchoDetector`, los sonidos en `SoundsService` (T-70) y la grabación en `ClientRecordingSession`.
 * T-58: con una llamada 1:1 en curso, `join()` no entra: toast "You're already in a call" con "Leave and join".
 */
@Injectable({ providedIn: 'root' })
export class ActiveMeetingService {
  private readonly rtc = inject(MeetingRtcService);
  private readonly auth = inject(AuthService);
  private readonly calls = inject(CallsService);
  private readonly activeCall = inject(ActiveCallService);
  private readonly toast = inject(ToastService);
  private readonly sfu = inject(MeetingSfuService);
  private readonly sounds = inject(SoundsService);
  private readonly http = inject(HttpClient);
  private readonly cloudStorage = inject(CloudStorageUploadService);
  private readonly api = inject(ApiConfigService);
  private readonly mediaPolicy = inject(MediaPolicyService);
  private readonly sessionFactory = inject(LocalMediaSessionFactory);
  private readonly peerFactory = inject(PeerConnectionFactory);
  private readonly recordingUpload = inject(RecordingUploadService);

  /** Fase de la sesión. El signal vive en `MeetingSessionState` para que el shell lo lea sin este servicio. */
  readonly phase = inject(MeetingSessionState).phase;
  readonly meetingId = signal<string | null>(null);
  readonly meetingTitle = signal<string>('');
  readonly conversationId = signal<string | null>(null);
  readonly participants = signal<MeetingParticipantDto[]>([]);
  /**
   * F3 — rol propio REACTIVO: lo fija el snapshot y lo actualiza cada `participant.changed` con mi
   * userId y `meeting.host.changed`. El `state.changed` posterior NO lo toca (trae `hostUserId`, no mi rol).
   */
  readonly yourRole = signal<MeetingRole>('Attendee');
  readonly hostUserId = signal<string | null>(null);
  readonly strategy = signal<MeetingStrategy>('Mesh');
  readonly isLocked = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly myUserId = signal<string | null>(null);
  /**
   * F6 (D-47) — entré como INVITADO EXTERNO (`joinAsGuest`): sin JWT, userId = invitationId, sin
   * acciones de host ni grabación, chat solo texto; el ICE viene en el ack del join (no hay `GET /webrtc/ice`).
   */
  readonly isGuest = signal(false);
  private guestInvitationId: string | null = null;
  /** Último nombre con el que el roster me mostró: el tile "You" lo conserva aunque mi fila ya no esté (expulsión). */
  private readonly lastSelfDisplayName = signal<string | null>(null);
  /** F6 — motivo del último `meeting.you.removed` (p. ej. `Revoked` al guest); null hasta que ocurre. Se limpia al entrar. */
  readonly removedReason = signal<MeetingYouRemovedReason | null>(null);

  // ---------- F3: reloj y fin ----------
  /** Corte real según el servidor (ISO); null = sin tope → no se muestra restante. */
  readonly endsAtUtc = signal<string | null>(null);
  readonly maxDurationMinutes = signal<number | null>(null);
  readonly scheduledDurationMinutes = signal<number | null>(null);
  /** Motivo con el que terminó (del `state.changed`/`meeting.ended`); null mientras está viva o si no terminó por el sistema. */
  readonly endReason = signal<MeetingEndReason | 'Expired' | null>(null);
  /** true cuando la reunión TERMINÓ (fin por host/sistema), no cuando me denegaron/sacaron o se canceló. */
  readonly meetingEnded = signal(false);
  /** Último aviso de tiempo (`meeting.duration.warning`); persiste hasta el siguiente umbral. */
  readonly durationWarning = signal<MeetingDurationWarningDto | null>(null);
  /** Reloj local que avanza 1/s mientras estoy dentro; el restante se calcula contra el reloj del servidor (T-41). También da el "raised 2m ago" de las manos. */
  readonly nowMs = signal(Date.now());
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private joinedAtMs: number | null = null;
  readonly remainingSeconds = computed(() => remainingSecondsAt(this.endsAtUtc(), this.nowMs(), this.rtc.serverOffsetMs()));
  /** Transcurrido: desde el inicio real (tope − restante) o, sin tope, desde que entré. */
  readonly elapsedSeconds = computed(() => {
    const remaining = this.remainingSeconds();
    const max = this.maxDurationMinutes();
    if (remaining !== null && max !== null) {
      return Math.max(0, max * 60 - remaining);
    }
    return this.joinedAtMs === null ? 0 : Math.max(0, Math.floor((this.nowMs() - this.joinedAtMs) / MS_PER_SECOND));
  });
  /** "12:05 / 47:55" (transcurrido / restante) o solo "12:05" sin tope. */
  readonly clockLabel = computed(() => {
    const remaining = this.remainingSeconds();
    const elapsed = formatClock(this.elapsedSeconds());
    return remaining === null ? elapsed : `${elapsed} / ${formatClock(remaining)}`;
  });
  /** Título de la pantalla de fin: el motivo del servidor si terminó, o el aviso (denegado/removido/cancelado). */
  readonly endedTitle = computed(() =>
    this.meetingEnded() ? meetingEndedMessage(this.endReason()) : (this.errorMessage() ?? 'The meeting has ended'),
  );
  /**
   * F1 — estado del enlace de media (mesh: peor peer; SFU: peor transport). La sala muestra
   * "Reconnecting…" o "Media connection failed" + Retry.
   */
  readonly mediaState = signal<MediaLinkState>('ok');
  /** Esta pestaña compartía pantalla antes de un re-join completo (recarga): ofrecer "Resume sharing". */
  readonly screenShareInterrupted = signal(false);

  // ---------- Media (espejo de la sesión local) ----------
  readonly localStream = signal<MediaStream | null>(null);
  /** Mi pantalla mientras comparto (separada de la cámara), para el escenario local. */
  readonly localScreenStream = signal<MediaStream | null>(null);
  readonly audioEnabled = signal(true);
  readonly videoEnabled = signal(true);
  readonly handRaised = signal(false);
  /** F5 — cuándo levanté la mano (lo fija el ack del servidor); null = baja. */
  readonly handRaisedAtUtc = signal<string | null>(null);
  readonly screenSharing = signal(false);
  /** Comparto también el audio de la pantalla (D-41). */
  readonly screenAudioSharing = signal(false);
  /** Motivo de la restricción vigente (mute por eco/host, video pausado por red); null = ninguna. */
  readonly muteReason = signal<MuteReason | null>(null);
  readonly videoPausedByNetwork = signal(false);
  /** El micrófono no se pudo capturar al entrar (sin dispositivo / bloqueado): "No microphone" en los controles. */
  readonly microphoneError = signal<MediaAccessError | null>(null);
  /** Calidad de conexión propia (D-39) y sus cifras (solo staff las ve). */
  readonly connectionQuality = signal<ConnectionQuality | null>(null);
  readonly connectionMetrics = signal<QualityMetrics | null>(null);
  /** Peers remotos y sus streams, por userId. */
  readonly peers = signal<Map<string, MeetingPeer>>(new Map());

  /** Chat del meeting (live-only en este slice: mensajes desde que entraste). */
  readonly chatMessages = signal<MeetingChatMessage[]>([]);
  /** Mensajes ajenos llegados con el chat cerrado (badge de la sala y del mini-player). `markChatRead()` lo limpia. */
  readonly chatUnread = signal(0);
  /** F8 (D-64): ventana de edición del chat de la sala (llega con el historial). */
  readonly chatEditPolicy = signal<ChatEditPolicy | null>(null);
  /** F8a: subiendo un adjunto al chat de la sala. */
  readonly chatUploading = signal(false);

  // ---------- F5: reacciones (D-50) ----------
  /** Burbujas vivas (se barren al vencer `reactions.durationSeconds`). Nunca van al historial del chat. */
  readonly reactions = signal<readonly MeetingReaction[]>([]);
  /** Última reacción por participante (burbuja sobre su tile). */
  readonly reactionByUser = computed(() => latestReactionByUser(this.reactions()));
  /** Texto para la región `aria-live` ("Ana reacted 👍"). */
  readonly reactionAnnouncement = signal('');
  readonly reactionsPolicy = computed(() => this.mediaPolicy.policy()?.reactions ?? null);
  /** Oculto si la política las apaga (o el backend aún no la expone). */
  readonly reactionsEnabled = computed(() => this.reactionsPolicy()?.enabled === true);
  private reactionSeq = 0;
  private reactionSweep: ReturnType<typeof setInterval> | null = null;

  // ---------- Grabación ----------
  readonly recordingState = signal<MeetingRecordingState>('Idle');
  /** F7 — `Server` (el recorder captura del SFU) o `Client` (mezcla local); null hasta el primer estado. */
  readonly recordingCaptureMode = signal<RecordingCaptureMode | null>(null);
  /** Reloj del badge REC contra el reloj del servidor (`startedAtUtc`), con restante si hay tope. */
  private readonly recordingClock = new RecordingClock(() => this.rtc.serverOffsetMs(), RECORDING_TICK_MS);
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
  readonly isRecordingRequester = computed(
    () => !!this._recordingRequesterId() && this._recordingRequesterId() === (this.auth.currentUser()?.id ?? null),
  );
  private readonly recording = new ClientRecordingSession();

  /** Host o cohost: ven los controles de host. */
  readonly isHost = computed(() => this.yourRole() === 'Host' || this.yourRole() === 'Cohost');
  /** Solo el host principal: "Make host". */
  readonly isPrimaryHost = computed(() => this.yourRole() === 'Host');
  /** "End meeting" (POST /meetings/{id}/end): host y cohost (D-07). */
  readonly canEndForAll = computed(() => this.isHost());

  // ---------- Vista (sala completa vs mini-player) ----------
  /**
   * true mientras la sala completa (`app-meeting-room`) está montada. La pone/quita la sala en su
   * ciclo de vida; el mini-player global se oculta mientras sea true. NO se toca en `reset()`.
   */
  readonly roomViewAttached = signal(false);
  /** El panel de chat de la sala está abierto: el mensaje entrante suena distinto (`chat-message`). */
  readonly chatPanelOpen = signal(false);
  /** Participante fijado (spotlight) en la sala; el mini-player lo usa si nadie está hablando. */
  readonly pinnedUserId = signal<string | null>(null);
  /** Participantes efectivamente dentro (no en espera ni salidos) — para la grilla. */
  readonly joinedParticipants = computed(() => this.participants().filter(p => p.status === 'Joined'));
  /** Participantes dentro que NO soy yo (para las tiles remotas). */
  readonly remoteParticipants = computed(() => this.joinedParticipants().filter(p => p.userId !== this.myUserId()));
  /** En sala de espera (solo el host los ve para admitir/denegar). */
  readonly waitingParticipants = computed(() => this.participants().filter(p => p.status === 'Waiting'));
  /** F5 (D-49) — cola de manos, del que la levantó primero al último (incluida la mía). */
  readonly raisedHands = computed(() => sortRaisedHands(this.participants()));
  readonly raisedHandCount = computed(() => this.raisedHands().length);
  /**
   * F5 — mi fila del roster con MI estado local encima (mic/cámara/pantalla/mano/calidad son
   * instantáneos aquí y llegan con retraso por el socket). Es lo que pinta el tile único "You".
   */
  readonly selfParticipant = computed<MeetingParticipantDto>(() => {
    const me = this.myUserId();
    const fromRoster = this.participants().find(p => p.userId === me);
    // El guest nunca cae en la sesión de staff que pueda haber en este navegador.
    const user = this.isGuest() ? null : this.auth.currentUser();
    return {
      userId: me ?? 'me',
      displayName: fromRoster?.displayName ?? this.lastSelfDisplayName() ?? (user ? `${user.name} ${user.lastName}`.trim() || 'You' : 'You'),
      actorType: fromRoster?.actorType,
      avatarFileId: fromRoster?.avatarFileId ?? user?.avatarFileId ?? null,
      role: fromRoster?.role ?? this.yourRole(),
      status: 'Joined',
      joinOrder: fromRoster?.joinOrder ?? -1,
      audioEnabled: this.audioEnabled(),
      videoEnabled: this.videoEnabled(),
      screenSharing: this.screenSharing(),
      handRaised: this.handRaised(),
      handRaisedAtUtc: this.handRaised() ? (this.handRaisedAtUtc() ?? fromRoster?.handRaisedAtUtc ?? null) : null,
      connectionQuality: this.connectionQuality(),
    };
  });

  // ---------- Capa de media (F4) ----------
  private policy: MediaPolicyDto | null = null;
  private session: LocalMediaSession | null = null;
  private readonly peerConns = new Map<string, PeerConn>();
  private monitor: QualityMonitor | null = null;
  private echo: EchoDetector | null = null;
  /** D-40: 0 = normal, 1 = capa media (recuperando), 2 = solo audio. */
  private degradeStep = 0;
  private iceServers: IceServer[] = [];
  /** Usuarios que salieron (Left) desde que entré: si vuelven, suena `rejoin` en vez de `join`. */
  private readonly leftUserIds = new Set<string>();
  private chatHistoryLoaded = false;
  private listenersBound = false;
  /** F5 — último estado de mano que PEDÍ (para reenviarlo tras una reconexión si el servidor lo perdió). */
  private desiredHand = false;
  /** Ack de `raise_hand` en vuelo: mientras tanto el `participant.changed` propio no pisa el optimista. */
  private handAckPending = false;
  /** F5 (T-69) — `meeting.speaking` acotado por `speaking.maxPerSecond`. */
  private speakingThrottle: SpeakingThrottle | null = null;
  private lastReportedSpeaking: boolean | null = null;
  /** `meeting.leave` ya enviado por pagehide/beforeunload en esta sesión (los dos eventos pueden dispararse). */
  private unloadLeaveSent = false;

  constructor() {
    // F3 — al cerrar sesión (logout / `session.revoked`) se sale de la reunión y se apaga la media
    // antes de navegar al login. Registro, no inyección directa: AuthService no puede depender de este servicio.
    inject(SessionTeardownRegistry).register(() => this.leave());
  }

  private bindListenersOnce(): void {
    if (this.listenersBound) {
      return;
    }
    this.listenersBound = true;

    // Cerrar/recargar la pestaña: avisar `meeting.leave` sin esperar ack (no hay tiempo), una sola vez.
    if (typeof window !== 'undefined') {
      const onUnload = () => this.leaveOnUnload();
      window.addEventListener('pagehide', onUnload);
      window.addEventListener('beforeunload', onUnload);
    }

    // El backend NO emite `meeting.snapshot` para el join directo (el snapshot llega inline en el
    // ack del join → lo aplica `join()`); este evento solo se emite al ADMITIR desde la sala de
    // espera. Se deja suscrito para esa transición waiting→joined y como fallback idempotente.
    this.rtc.onSnapshot().subscribe(snap => this.applySnapshot(snap));

    // Foto/nombre del staff en vivo: se parchea el roster por userId.
    this.rtc.onUserProfileChanged().subscribe(change =>
      this.participants.update(list => applyProfileChangeToRoster(list, change)),
    );

    // Reconnect transparente del socket (churn del tunnel): si seguimos dentro de un meeting, re-unir
    // la room `m:` para no perder participantes/controles/señalización. La media mesh sigue viva; solo
    // se reconcilia el roster. La room de chat del meeting la re-une el join-on-connect del server.
    this.rtc.reconnected$.subscribe(() => void this.handleSocketReconnected());

    this.rtc.onParticipantChanged().subscribe(dto => {
      if (dto.meetingId !== this.meetingId()) {
        return;
      }
      // El host ME sacó: se trata como fin del meeting (pantalla de terminado / toast del mini-player).
      if (dto.participant.userId === this.myUserId() && dto.participant.status === 'Removed' && this.phase() !== 'idle') {
        this.errorMessage.set('You were removed from the meeting.');
        this.sounds.play('leave', { isHost: this.isHost() });
        this.phase.set('ended');
        this.stopLocalMedia();
        return;
      }
      this.playParticipantSound(dto.participant);
      this.applyParticipantChange(dto.participant);
      const p = dto.participant;
      if (p.userId === this.myUserId()) {
        if (p.displayName) this.lastSelfDisplayName.set(p.displayName);
        // F3 — mi rol cambia por eventos (promote/demote, transfer, sucesión): el roster es la fuente.
        if (p.status === 'Joined' || p.status === 'Waiting') {
          this.yourRole.set(p.role);
        }
        // F5 — mi mano según el servidor (salvo que tenga un ack en vuelo que ya la cambió en local).
        if (!this.handAckPending && p.status === 'Joined') {
          this.setOwnHand(p.handRaised, p.handRaisedAtUtc ?? null);
          this.desiredHand = p.handRaised;
        }
        return;
      }
      if (this.strategy() === 'Sfu') {
        return; // en SFU el media lo maneja mediasoup (consumers), no el mesh
      }
      if (p.status === 'Left' || p.status === 'Removed') {
        this.disconnectFromPeer(p.userId);
      } else if (p.status === 'Joined') {
        // `connectToPeer` es auto-sanador: PC vivo con el MISMO joinOrder → nada; muerto o joinOrder NUEVO
        // (re-join) → lo descarta y rearma. Así el re-join reconecta aunque el otro lado tuviera un PC stale.
        this.connectToPeer(p.userId, p.joinOrder);
      }
      this.updateMeshCameraProfile();
    });

    // F4 — calidad de cada participante (badge del tile; D-39).
    this.rtc.onParticipantQualityChanged().subscribe(dto => {
      if (dto.meetingId !== this.meetingId()) {
        return;
      }
      this.participants.update(list => list.map(p => (p.userId === dto.userId ? { ...p, connectionQuality: dto.quality } : p)));
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
      void this.setAudioEnabled(false, 'host').then(() => this.toast.info('You were muted by the host.'));
    });

    this.rtc.onChatMessageNew().subscribe(dto => {
      if (dto.conversationId !== this.conversationId()) {
        return;
      }
      this.chatMessages.update(list => {
        if (list.some(m => m.id === dto.id)) {
          return list; // dedupe (el propio broadcast del remitente)
        }
        if (dto.senderId !== this.myUserId() && dto.kind !== 'System') {
          // Con el chat abierto, un sonido de "mensaje recibido"; cerrado, el aviso general + badge.
          this.sounds.play(this.chatPanelOpen() ? 'chat-message' : 'notification', { isHost: this.isHost() });
          if (!this.chatPanelOpen()) {
            this.chatUnread.update(n => n + 1);
          }
        }
        return [...list, this.toChatView(dto)];
      });
    });

    // F8: ediciones y borrados del chat de la sala.
    this.rtc.onChatMessageEdited().subscribe(edit => {
      if (edit.conversationId !== this.conversationId()) return;
      this.chatMessages.update(list =>
        list.map(m => (m.id === edit.messageId ? { ...m, text: edit.body, isEdited: true, editCount: edit.editCount ?? m.editCount + 1 } : m)),
      );
    });
    // F8d: reacciones en vivo del chat de la sala.
    const onReaction = (change: { messageId: string; conversationId: string; userId: string; emoji: string }, delta: 1 | -1): void => {
      if (change.conversationId !== this.conversationId()) return;
      this.chatMessages.update(list =>
        list.map(m => (m.id === change.messageId ? { ...m, reactions: applyReaction(m.reactions ?? [], change, delta) } : m)),
      );
    };
    this.rtc.onChatReactionAdded().subscribe(change => onReaction(change, 1));
    this.rtc.onChatReactionRemoved().subscribe(change => onReaction(change, -1));

    // T-20: en revisión / bloqueado / aprobado por el revisor, en vivo.
    this.rtc.onChatAttachmentFlagged().subscribe(flag => {
      if (flag.conversationId !== this.conversationId()) return;
      const status = moderationStateOf(flag.status);
      this.attachmentNames.set(flag.fileId, { ...(this.attachmentNames.get(flag.fileId) ?? { name: 'Attachment', size: '' }), status });
      this.chatMessages.update(list =>
        list.map(m => (m.attachment?.fileId === flag.fileId ? { ...m, attachment: { ...m.attachment, status } } : m)),
      );
    });

    this.rtc.onChatMessageDeleted().subscribe(deleted => {
      if (deleted.conversationId !== this.conversationId()) return;
      this.chatMessages.update(list =>
        list.map(m => (m.id === deleted.messageId ? { ...m, isDeleted: true, text: '(message deleted)', attachment: undefined } : m)),
      );
    });

    this.rtc.onStateChanged().subscribe(dto => {
      if (dto.meetingId !== this.meetingId()) {
        return;
      }
      this.isLocked.set(dto.isLocked);
      // Solo el hostUserId: mi rol ya llegó por `participant.changed`/`host.changed` y NO se revierte acá.
      this.hostUserId.set(dto.hostUserId);
      if (dto.status === 'Ended' || dto.status === 'Expired') {
        this.finishByServer(dto.status === 'Expired' ? 'Expired' : (dto.endReason ?? null));
      } else if (dto.status === 'Cancelled') {
        this.finishByServer(null, 'This meeting was cancelled.');
      }
    });

    // ----- F3: ciclo de vida, host y sesión -----
    // Terminó (room de usuario). Si el `state.changed` de la sala no llegó (socket caído), esto cierra igual.
    this.rtc.onEnded().subscribe(dto => {
      if (dto.meetingId !== this.meetingId() || !IN_MEETING_PHASES.includes(this.phase())) {
        return;
      }
      this.finishByServer(dto.reason ?? null);
    });

    this.rtc.onDurationWarning().subscribe(dto => {
      if (dto.meetingId !== this.meetingId() || this.phase() !== 'joined') {
        return;
      }
      this.endsAtUtc.set(dto.endsAtUtc);
      this.durationWarning.set(dto);
      this.sounds.play('notification', { isHost: this.isHost() });
    });

    // Llega DESPUÉS de los dos `participant.changed` (saliente Cohost, entrante Host) y ANTES del
    // `state.changed`: acá se garantiza el rol propio y el roster aunque alguno se perdiera.
    this.rtc.onHostChanged().subscribe(dto => {
      if (dto.meetingId !== this.meetingId()) {
        return;
      }
      const me = this.myUserId();
      this.hostUserId.set(dto.newHostUserId);
      if (dto.newHostUserId === me) {
        this.yourRole.set('Host');
      } else if (dto.previousHostUserId === me && this.yourRole() === 'Host') {
        this.yourRole.set('Cohost');
      }
      this.participants.update(list =>
        list.map(p =>
          p.userId === dto.newHostUserId
            ? { ...p, role: 'Host' as MeetingRole }
            : p.userId === dto.previousHostUserId && p.role === 'Host'
              ? { ...p, role: 'Cohost' as MeetingRole }
              : p,
        ),
      );
      if (dto.newHostUserId !== me && this.phase() === 'joined') {
        const name = this.participants().find(p => p.userId === dto.newHostUserId)?.displayName ?? 'Someone';
        this.toast.info(`${name} is now the host.`);
      }
    });

    // El servidor me sacó (gracia vencida, sesión revocada/expirada, retiro, fin, expulsión): salida LOCAL,
    // sin `meeting.leave` (ya no estoy en la room). El motivo va en un toast.
    this.rtc.onYouRemoved().subscribe(dto => {
      if (dto.meetingId !== this.meetingId() || this.phase() === 'idle') {
        return;
      }
      const wasIn = this.phase() === 'joined';
      const wasHost = this.isHost();
      this.removedReason.set(dto.reason);
      this.reset();
      if (wasIn) {
        this.sounds.play('leave', { isHost: wasHost });
      }
      this.toast.info(youRemovedMessage(dto.reason));
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
        this.sounds.play('notification', { isHost: this.isHost() });
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
      this.applyRecordingState(dto);
    });

    // F7 — aviso de tope de la grabación; al llegar al tope el servidor la para (la reunión sigue).
    this.rtc.onRecordingLimitWarning().subscribe(dto => {
      if (dto.meetingId === this.meetingId()) {
        this.toast.info(recordingLimitWarningMessage(dto.remainingSeconds));
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

    // ----- F5: manos (D-49) y reacciones (D-50) -----
    this.rtc.onHandLoweredByHost().subscribe(dto => {
      if (dto.meetingId !== this.meetingId()) {
        return;
      }
      this.setOwnHand(false, null);
      this.desiredHand = false;
      this.toast.info(dto.all ? 'The host lowered all hands.' : 'The host lowered your hand.');
    });

    this.rtc.onReactionReceived().subscribe(dto => {
      if (dto.meetingId !== this.meetingId() || this.phase() !== 'joined') {
        return;
      }
      this.showReaction(dto.userId, dto.displayName, dto.emoji, receivedAtMs(dto, Date.now()), false);
    });
  }

  /** Pinta una burbuja (propia al ack o ajena al broadcast) y la anuncia en `aria-live`. */
  private showReaction(userId: string, displayName: string, emoji: string, atMs: number, local: boolean): void {
    const duration = this.reactionsPolicy()?.durationSeconds ?? 0;
    if (duration <= 0) {
      return; // política sin reacciones: nada que mostrar
    }
    const before = this.reactions();
    const next = addReaction(before, { userId, displayName, emoji, local }, atMs, duration, ++this.reactionSeq);
    this.reactions.set(next);
    if (next.length > before.length) {
      this.reactionAnnouncement.set(`${userId === this.myUserId() ? 'You' : displayName} reacted ${emoji}`);
    }
    this.startReactionSweep();
  }

  private startReactionSweep(): void {
    if (this.reactionSweep) {
      return;
    }
    this.reactionSweep = setInterval(() => {
      const pruned = pruneReactions(this.reactions(), Date.now());
      if (pruned !== this.reactions()) {
        this.reactions.set(pruned);
      }
      if (pruned.length === 0) {
        this.stopReactionSweep();
      }
    }, REACTION_SWEEP_MS);
  }

  private stopReactionSweep(): void {
    if (this.reactionSweep) {
      clearInterval(this.reactionSweep);
      this.reactionSweep = null;
    }
  }

  /**
   * Aplica el snapshot autoritativo de "ya estás dentro" (strategy, participantes, rol, conversationId):
   * llega inline en el ack del join directo, o por el evento `meeting.snapshot` al ser admitido desde la
   * sala de espera. Idempotente (el snapshot del admit re-concilia la lista). Decide Mesh vs SFU.
   */
  private applySnapshot(snap: MeetingSnapshotDto): void {
    if (snap.meetingId !== this.meetingId()) {
      return;
    }
    this.strategy.set(snap.strategy);
    this.conversationId.set(snap.conversationId);
    // El guest no tiene JWT para el historial HTTP: ve solo lo que llega en vivo.
    if (snap.conversationId && !this.chatHistoryLoaded && !this.isGuest()) {
      this.chatHistoryLoaded = true;
      this.loadChatHistory(snap.conversationId);
    }
    this.yourRole.set(snap.yourRole);
    this.hostUserId.set(snap.hostUserId);
    this.isLocked.set(snap.isLocked);
    this.applyLifecycle(snap);
    this.participants.set(mergeMeetingRoster(this.participants(), snap.participants));
    const mine = snap.participants.find(p => p.userId === this.myUserId())?.displayName;
    if (mine) this.lastSelfDisplayName.set(mine);
    if (this.phase() !== 'joined') {
      this.joinedAtMs ??= Date.now();
      this.startClock();
      this.sounds.play('join', { isHost: this.isHost(), fallbackText: 'You joined the meeting' });
      // Re-join completo (recarga): la pantalla que compartía esta pestaña se perdió con el navegador.
      if (!this.screenSharing() && this.readShareFlag(snap.meetingId)) {
        this.screenShareInterrupted.set(true);
      }
    }
    this.phase.set('joined');
    // Mi estado inicial (mic/cámara/pantalla) para los que ya están.
    this.publishMediaStatus();
    this.startQualityMonitor();

    if (snap.strategy === 'Sfu') {
      void this.startSfu(); // >4: media por mediasoup (no mesh)
      return;
    }
    // Mesh: conectar con cada participante presente y depurar los ausentes (idempotente).
    this.reconcileMeshPeers(snap.participants);
    this.updateMeshCameraProfile();
  }

  /** F3 — tope/corte/duración del snapshot (join, admisión y rejoin); tolera snapshots viejos sin los campos. */
  private applyLifecycle(snap: Partial<MeetingSnapshotDto>): void {
    this.endsAtUtc.set(snap.endsAtUtc ?? null);
    this.maxDurationMinutes.set(snap.maxDurationMinutes ?? null);
    this.scheduledDurationMinutes.set(snap.scheduledDurationMinutes ?? null);
  }

  /**
   * Fin decidido por el servidor (host, tope de tiempo, todos se fueron, cancelación…): pantalla de fin
   * con el motivo y cámara/mic apagados. Idempotente: el `state.changed` y el `meeting.ended` pueden llegar los dos.
   */
  private finishByServer(reason: MeetingEndReason | 'Expired' | null, notice?: string): void {
    if (this.phase() === 'ended' || this.phase() === 'idle') {
      return;
    }
    if (this.phase() === 'joined') {
      this.sounds.play('leave', { isHost: this.isHost() });
    }
    this.endReason.set(reason);
    if (notice) {
      this.errorMessage.set(notice); // cancelación: aviso, no "fin" (sin continuación)
    }
    this.meetingEnded.set(!notice);
    this.durationWarning.set(null);
    this.stopClock();
    this.phase.set('ended');
    this.stopLocalMedia(); // apagar cámara/mic al terminar el meeting (no se llega por leave())
  }

  private startClock(): void {
    if (this.clockTimer) {
      return;
    }
    this.nowMs.set(Date.now());
    this.clockTimer = setInterval(() => this.nowMs.set(Date.now()), CLOCK_TICK_MS);
  }

  private stopClock(): void {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  /**
   * pagehide/beforeunload: `meeting.leave` fire-and-forget si seguimos dentro (una sola vez).
   * El host principal NO lo manda: "Leave" nunca cede el host, así que cerrar la pestaña dejaría la sala
   * sin nadie al mando; sin leave, el socket cae, corre la gracia y el servidor aplica la sucesión (D-08)
   * — y una recarga dentro de la gracia lo devuelve como host.
   */
  private leaveOnUnload(): void {
    const meetingId = this.meetingId();
    if (!meetingId || this.unloadLeaveSent || !IN_MEETING_PHASES.includes(this.phase()) || this.isPrimaryHost()) {
      return;
    }
    this.unloadLeaveSent = true;
    this.rtc.leaveNoAck(meetingId);
  }

  /**
   * Sonido por el cambio de OTRO participante, comparando con su estado anterior (el mismo evento
   * llega en cada toggle de mic/cámara, así que solo suena en las transiciones que importan).
   * Rejoin (Left→Joined según el servidor) suena distinto de una entrada nueva.
   */
  private playParticipantSound(next: MeetingParticipantDto): void {
    if (next.userId === this.myUserId() || this.phase() !== 'joined') {
      return;
    }
    const prev = this.participants().find(p => p.userId === next.userId);
    const wasIn = prev?.status === 'Joined';
    const isHost = this.isHost();
    if (!wasIn && next.status === 'Joined') {
      const rejoin = this.leftUserIds.delete(next.userId);
      this.sounds.play(rejoin ? 'rejoin' : 'join', { isHost, fallbackText: `${next.displayName} ${rejoin ? 'rejoined' : 'joined'}` });
    } else if (wasIn && (next.status === 'Left' || next.status === 'Removed')) {
      if (next.status === 'Left') {
        this.leftUserIds.add(next.userId);
      }
      this.sounds.play('leave', { isHost, fallbackText: `${next.displayName} left` });
    } else if (next.status === 'Waiting' && prev?.status !== 'Waiting' && isHost) {
      this.sounds.play('notification', { isHost }); // alguien pide entrar: solo el host puede admitirlo
    } else if (wasIn && next.status === 'Joined') {
      if (!prev.screenSharing && next.screenSharing) {
        this.sounds.play('screen-share', { isHost, fallbackText: `${next.displayName} is sharing their screen` });
      } else if (!prev.handRaised && next.handRaised && isHost) {
        // F5 — solo host/cohost se enteran (son quienes pueden darle la palabra o bajarla).
        this.sounds.play('notification', { isHost });
        this.toast.info(`${next.displayName} raised their hand`);
      }
    }
  }

  /** Upsert/baja de un participante según el contrato real (`status`). */
  private applyParticipantChange(participant: MeetingParticipantDto): void {
    this.participants.update(list => {
      const rest = list.filter(p => p.userId !== participant.userId);
      if (participant.status === 'Left' || participant.status === 'Removed') {
        return rest;
      }
      // Los cambios de media/mano llegan sin foto: se conserva la que ya se tenía.
      const merged = mergeMeetingParticipant(list.find(p => p.userId === participant.userId), participant);
      return [...rest, merged].sort((a, b) => a.joinOrder - b.joinOrder);
    });
  }

  /**
   * Entra a la reunión: política de media → captura local (preferencias `joinMuted`/`joinCameraOff`/
   * `preferAudioOnly` salvo que el lobby mande otra cosa) → `meeting.join`.
   */
  async join(meetingId: string, title: string, media: MeetingJoinMediaOptions = {}): Promise<void> {
    if (this.phase() !== 'idle') {
      return;
    }
    // T-58: una llamada 1:1 en curso tiene el micrófono; se ofrece colgar y entrar.
    if (this.activeCall.phase() !== 'idle') {
      this.toast.info("You're already in a call.", {
        action: { label: 'Leave and join', run: () => void this.activeCall.endCall().then(() => this.join(meetingId, title, media)) },
      });
      return;
    }
    await this.start(meetingId, title, media, null);
  }

  /**
   * F6 (D-47) — entra como INVITADO EXTERNO desde la página pública `/meet/:token`: el socket ya está
   * conectado con `auth.ticket` (`CommunicationRealtimeService.connectAsGuest`), la política de media ya
   * está en `MediaPolicyService.prime` (del contexto público) y el ICE llega en el ack de `meeting.join`.
   * Mi userId es el propio `guestInvitationId` (así me nombra el servidor en el roster).
   */
  async joinAsGuest(meetingId: string, title: string, guestInvitationId: string, media: MeetingJoinMediaOptions = {}): Promise<void> {
    if (this.phase() !== 'idle') {
      return;
    }
    await this.start(meetingId, title, media, guestInvitationId);
  }

  /** Arranque común de `join` / `joinAsGuest`: estado limpio → política → ICE → captura local → `meeting.join`. */
  private async start(meetingId: string, title: string, media: MeetingJoinMediaOptions, guestInvitationId: string | null): Promise<void> {
    this.bindListenersOnce();
    this.errorMessage.set(null);
    this.removedReason.set(null);
    this.meetingId.set(meetingId);
    this.meetingTitle.set(title);
    this.isGuest.set(guestInvitationId !== null);
    this.guestInvitationId = guestInvitationId;
    this.lastSelfDisplayName.set(null);
    // F6: el userId del guest es el propio invitationId (UUID), igual que el principal del servidor.
    this.myUserId.set(guestInvitationId ?? (this.auth.currentUser()?.id ?? null));
    this.participants.set([]);
    this.peers.set(new Map());
    this.leftUserIds.clear();
    this.audioEnabled.set(true);
    this.videoEnabled.set(true);
    this.handRaised.set(false);
    this.handRaisedAtUtc.set(null);
    this.desiredHand = false;
    this.chatUnread.set(0);
    this.unloadLeaveSent = false;
    this.degradeStep = 0;
    this.phase.set('joining');

    try {
      this.policy = await this.mediaPolicy.ensureLoaded();
    } catch {
      this.errorMessage.set('Could not load the meeting settings.');
      this.reset();
      return;
    }
    const policy = this.policy;
    if (this.phase() !== 'joining') {
      return; // se salió mientras cargaba
    }

    // El guest no tiene JWT para `GET /webrtc/ice`: usa el `iceServers` del ack del join (ver `attemptJoin`).
    if (guestInvitationId) {
      this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    } else {
      try {
        const ice = await firstValueFrom(this.calls.getIceServers());
        this.iceServers = ice.iceServers;
      } catch {
        this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
      }
    }

    // Captura con la política (AEC/NS/AGC, resolución). Si la cámara está ocupada se cae a solo audio;
    // SIEMPRE queda una pista de video (placeholder) para que el m-line exista desde el join.
    const session = this.sessionFactory.create(policy, {
      onLocalTrackReplaced: (source, track) => this.applyLocalTrack(source, track),
      onScreenShareStopped: () => this.onScreenShareStopped(),
    });
    this.session = session;
    // "Join muted" captura igual el micrófono (en mute): así el medidor avisa "You're muted" y el unmute es inmediato.
    const wantAudio = true;
    const wantVideo = (media.video ?? !policy.preferences.joinCameraOff) && !policy.preferences.preferAudioOnly;
    const acquired = await session.acquire({ audio: wantAudio, video: wantVideo, profile: 'camera' });
    this.microphoneError.set(acquired.audioError);
    if (!acquired.audio && !acquired.video) {
      this.errorMessage.set(acquired.audioError?.message ?? acquired.videoError?.message ?? 'Could not access your camera/microphone.');
    }
    if (acquired.audio && (media.audio === undefined ? policy.preferences.joinMuted : !media.audio)) {
      await session.setAudioEnabled(false, 'user');
    }
    this.syncFromSession();

    await this.attemptJoin();
  }

  /**
   * Un intento de `meeting.join` (con o sin passcode). Si el meeting exige passcode y no se dio / es
   * incorrecto, el backend responde `Meeting.InvalidPasscode`: se pasa a la fase `passcode`.
   */
  private async attemptJoin(passcode?: string): Promise<void> {
    const meetingId = this.meetingId();
    if (!meetingId) {
      return;
    }
    this.phase.set('joining');
    try {
      const guest = this.guestInvitationId;
      const opts = { ...(passcode ? { passcode } : {}), ...(guest ? { guestInvitationId: guest } : {}) };
      const ack = await this.rtc.join(meetingId, Object.keys(opts).length ? opts : undefined);
      this.errorMessage.set(null);
      // ICE del ack (paridad con el Portal): es la ÚNICA fuente para el guest; al staff le vale también.
      if (ack.iceServers?.iceServers?.length) {
        this.iceServers = ack.iceServers.iceServers;
      }
      if (ack.requiresAdmission) {
        // Al admitirnos, el backend emite `meeting.snapshot` → applySnapshot pone 'joined'/'unsupported'.
        this.phase.set('waiting');
      } else {
        // Join directo: el snapshot NO llega por evento, viene inline en el ack.
        this.applySnapshot(ack.snapshot);
        if (ack.handLoweredOnRejoin) {
          this.toast.info('Your hand was lowered when you left.'); // D-49: el re-join completo baja la mano
        }
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
   * el roster con el snapshot del ack. NO toca la media viva ni el conversationId; si el mesh quedó
   * incompleto durante el corte, `reconcileMeshPeers` re-conecta a los peers faltantes.
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
      this.hostUserId.set(snapshot.hostUserId);
      this.isLocked.set(snapshot.isLocked);
      this.applyLifecycle(snapshot);
      this.participants.set(mergeMeetingRoster(this.participants(), snapshot.participants));
      this.reconcileMeshPeers(snapshot.participants);
      this.reconcileOwnHand(snapshot.participants);
    } catch {
      // Best-effort: si el rejoin falla (ya no sos participante / meeting terminó), no rompemos el
      // estado local; el próximo evento o una recarga lo resuelven.
    }
  }

  /**
   * F5 (D-49) — mano tras la reconexión transparente (`meeting.rejoin` la conserva): se reenvía lo que
   * yo PEDÍ cuando difiere del snapshot. El re-join COMPLETO va por `meeting.join` (`handLoweredOnRejoin`).
   */
  private reconcileOwnHand(participants: readonly MeetingParticipantDto[]): void {
    const mine = participants.find(p => p.userId === this.myUserId());
    const serverRaised = mine?.handRaised ?? false;
    if (serverRaised !== this.desiredHand) {
      void this.sendHand(this.desiredHand);
    } else {
      this.setOwnHand(serverRaised, mine?.handRaisedAtUtc ?? null);
    }
  }

  /** Conecta a los peers Joined que falten y depura los ausentes (idempotente). No-op en SFU. */
  private reconcileMeshPeers(participants: MeetingParticipantDto[]): void {
    if (this.strategy() === 'Sfu') {
      return;
    }
    const myId = this.myUserId();
    participants.filter(p => p.status === 'Joined' && p.userId !== myId).forEach(p => this.connectToPeer(p.userId, p.joinOrder));
    const present = new Set(participants.map(p => p.userId));
    [...this.peerConns.keys()].filter(id => !present.has(id)).forEach(id => this.disconnectFromPeer(id));
  }

  /** Mesh con ≥ N participantes → cámara reducida (`meshCamera`); menos → perfil completo. */
  private updateMeshCameraProfile(): void {
    if (this.strategy() !== 'Mesh' || !this.session) {
      return;
    }
    const crowded = this.joinedParticipants().length >= MESH_REDUCED_PROFILE_FROM;
    void this.session.applyCameraProfile(crowded ? 'meshCamera' : 'camera');
  }

  // ---------- Mesh WebRTC (perfect negotiation por peer, vía PeerLink) ----------

  /**
   * Idempotente y AUTO-SANADOR: si ya hay un enlace vivo con el mismo joinOrder no hace nada; si está
   * muerto (failed/closed) o el joinOrder es NUEVO (el peer RE-ENTRÓ), descarta el stale y rearma.
   */
  private connectToPeer(peerUserId: string, joinOrder?: number): void {
    const myId = this.myUserId();
    const session = this.session;
    if (!myId || peerUserId === myId || !session) {
      return;
    }
    const existing = this.peerConns.get(peerUserId);
    if (existing) {
      // 'disconnected' puede recuperarse solo → NO se recrea por eso; el re-join se detecta por joinOrder.
      const state = existing.link.connectionState;
      const dead = state === 'failed' || state === 'closed';
      // Rearma SOLO si el joinOrder entrante es MAYOR (re-join real; joinOrder es monótono creciente).
      // Antes cualquier diferencia rearmaba y la carrera leave+join recreaba el PC en bucle.
      const rejoined = joinOrder !== undefined && existing.joinOrder !== undefined && joinOrder > existing.joinOrder;
      if (!dead && !rejoined) {
        if (existing.joinOrder === undefined && joinOrder !== undefined) {
          existing.joinOrder = joinOrder;
        }
        return; // enlace vivo y vigente → nada que hacer
      }
      this.disconnectFromPeer(peerUserId); // stale (muerto o re-join) → recrear limpio
    }

    const policy = this.policy;
    let link: PeerLink;
    try {
      link = this.peerFactory.create({
        iceServers: this.iceServers as RTCIceServer[],
        // Polite/impolite DETERMINISTA por userId: ambos lados calculan la misma relación.
        isPolite: () => myId < peerUserId,
        canOffer: () => true, // ambos pueden ofertar; el glare lo resuelve perfect-negotiation
        local: {
          microphone: session.audioOutTrack(),
          camera: session.cameraOutTrack(),
          screen: session.screenOutTrack(),
          screenAudio: session.screenAudioOutTrack(),
          stream: session.stream(),
          screenStream: session.screenOutStream(),
        },
        opus: policy ? { fec: policy.audio.opusFec, dtx: policy.audio.opusDtx, maxAverageBitrateKbps: policy.audio.maxAverageBitrateKbps } : null,
        signal: (kind, data) => this.rtc.signal(this.meetingId()!, peerUserId, kind, data),
        onLinkState: () => this.recomputeMediaState(),
        onClosed: () => this.disconnectFromPeer(peerUserId),
      });
    } catch {
      return; // sin soporte de WebRTC (tests): sin enlace
    }
    this.peerConns.set(peerUserId, { link, joinOrder });
    // Dos streams remotos por peer (los arma el enlace): cámara (con el audio) y pantalla (con su audio).
    this.peers.update(map => {
      const next = new Map(map);
      next.set(peerUserId, { userId: peerUserId, cameraStream: link.remoteCameraStream, screenStream: link.remoteScreenStream });
      return next;
    });
  }

  private recomputeMediaState(): void {
    this.mediaState.set(aggregateMediaState([...this.peerConns.values()].map(c => c.link.linkState)));
  }

  /**
   * Reintento manual tras "Media connection failed": en SFU rearma los dos transports (y vuelve a
   * publicar la pantalla si se estaba compartiendo); en mesh recrea solo los peers caídos.
   */
  async retryMedia(): Promise<void> {
    if (this.phase() !== 'joined') {
      return;
    }
    this.mediaState.set('reconnecting');
    if (this.strategy() === 'Sfu') {
      this.sfu.leave();
      await this.startSfu(); // `startSfu` vuelve a producir cámara, micro y pantalla desde la sesión
      return;
    }
    for (const [peerUserId, conn] of [...this.peerConns]) {
      if (conn.link.linkState !== 'failed') {
        continue;
      }
      this.disconnectFromPeer(peerUserId);
      const participant = this.participants().find(p => p.userId === peerUserId);
      if (participant?.status === 'Joined') {
        this.connectToPeer(peerUserId, participant.joinOrder);
      }
    }
    this.recomputeMediaState();
  }

  private async handleSignal(fromPeerUserId: string, kind: PeerSignalKind, data: unknown): Promise<void> {
    if (!this.peerConns.has(fromPeerUserId)) {
      this.connectToPeer(fromPeerUserId);
    }
    await this.peerConns.get(fromPeerUserId)?.link.handleSignal(kind, data);
  }

  private disconnectFromPeer(peerUserId: string): void {
    const conn = this.peerConns.get(peerUserId);
    conn?.link.close();
    this.peerConns.delete(peerUserId);
    this.recomputeMediaState();
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
    const session = this.session;
    const policy = this.policy;
    if (!meetingId || !session || !policy) {
      return;
    }
    const ok = await this.sfu.join(
      meetingId,
      {
        audio: session.audioOutTrack(),
        camera: session.cameraOutTrack(),
        screen: session.screenSharing() ? session.screenOutTrack() : null,
        screenAudio: session.screenAudioTrack(),
      },
      {
        onRemoteStream: (userId, source, stream) => this.setSfuPeer(userId, source, stream),
        onRemovePeer: userId => this.disconnectFromPeer(userId),
        onMediaState: state => this.mediaState.set(state),
      },
      policy,
    );
    if (!ok) {
      // El SFU no pudo arrancar (device/transport): degradar con mensaje claro.
      this.phase.set('unsupported');
      return;
    }
    this.mediaState.set('ok');
    if (policy.preferences.preferAudioOnly) {
      void this.sfu.setReceiveLowLayers(true); // "prefer audio on poor connections": capa baja de entrada
    }
  }

  /** Upsert de un stream SFU en el peer, en el slot correcto (cámara o pantalla), preservando el otro. */
  private setSfuPeer(userId: string, source: 'camera' | 'screen', stream: MediaStream): void {
    this.peers.update(map => {
      const next = new Map(map);
      const existing = next.get(userId);
      const cameraStream = source === 'camera' ? stream : (existing?.cameraStream ?? new MediaStream());
      const screenStream = source === 'screen' ? stream : (existing?.screenStream ?? new MediaStream());
      next.set(userId, { userId, cameraStream, screenStream });
      return next;
    });
  }

  // ---------- Controles de media (delegan en la sesión local) ----------

  async toggleAudio(): Promise<void> {
    await this.setAudioEnabled(!this.audioEnabled(), 'user');
  }

  private async setAudioEnabled(enabled: boolean, reason: MuteReason): Promise<void> {
    if (!this.session) {
      this.audioEnabled.set(enabled);
      this.publishMediaStatus();
      return;
    }
    await this.session.setAudioEnabled(enabled, reason);
    this.syncFromSession();
    this.publishMediaStatus();
  }

  async toggleVideo(): Promise<void> {
    if (!this.session) {
      return;
    }
    // Cámara INDEPENDIENTE del screen share (cada uno tiene su propio sender/producer).
    await this.session.setVideoEnabled(!this.session.videoEnabled());
    this.syncFromSession();
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

  /** F5 (D-49) — optimista + ack; si el servidor lo rechaza vuelve atrás con el motivo. */
  async toggleHandRaise(): Promise<void> {
    const raised = !this.handRaised();
    this.desiredHand = raised;
    await this.sendHand(raised);
  }

  private async sendHand(raised: boolean): Promise<void> {
    const meetingId = this.meetingId();
    if (!meetingId || this.phase() !== 'joined') {
      return;
    }
    const previous = { raised: this.handRaised(), at: this.handRaisedAtUtc() };
    this.setOwnHand(raised, raised ? (previous.at ?? new Date().toISOString()) : null);
    this.handAckPending = true;
    try {
      const ack = await this.rtc.raiseHand(meetingId, raised);
      if (this.desiredHand === raised) {
        this.setOwnHand(ack.handRaised, ack.handRaisedAtUtc ?? null);
      }
    } catch (err) {
      if (this.desiredHand === raised) {
        this.setOwnHand(previous.raised, previous.at); // rollback
        this.desiredHand = previous.raised;
        this.toast.error(handErrorMessage((err as { code?: string })?.code, raised));
      }
    } finally {
      this.handAckPending = false;
    }
  }

  /** Mi mano en los signals y en mi fila del roster (para que la cola y los tiles coincidan). */
  private setOwnHand(raised: boolean, at: string | null): void {
    this.handRaised.set(raised);
    this.handRaisedAtUtc.set(raised ? at : null);
    const me = this.myUserId();
    if (me) {
      this.participants.update(list =>
        list.map(p => (p.userId === me && (p.handRaised !== raised || p.handRaisedAtUtc !== at) ? { ...p, handRaised: raised, handRaisedAtUtc: raised ? at : null } : p)),
      );
    }
  }

  // ---------- F5: reacciones (D-50) ----------

  /** Envía una reacción del catálogo; la burbuja propia se pinta al ack, el broadcast no la duplica. */
  async react(emoji: string): Promise<void> {
    const meetingId = this.meetingId();
    if (!meetingId || this.phase() !== 'joined' || !this.reactionsEnabled()) {
      return;
    }
    try {
      await this.rtc.react(meetingId, emoji);
      const me = this.myUserId();
      if (me) {
        this.showReaction(me, this.selfParticipant().displayName, emoji, Date.now(), true);
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      this.toast.error(isSocketRateLimited(socketErrorCode(err)) ? SOCKET_RATE_LIMITED_MESSAGE : reactionErrorMessage(code));
    }
  }

  // ---------- F5: hablante propio (T-69) ----------

  /** Pista clonada del micrófono para medir mi nivel (también en mute → "You're muted"). */
  localMeterTrack(): MediaStreamTrack | null {
    return this.session?.meterTrack() ?? null;
  }

  /** Mi estado de habla cambió (lo decide `MeetingActiveSpeakerService`): `meeting.speaking` acotado por la política. */
  reportSpeaking(speaking: boolean): void {
    const meetingId = this.meetingId();
    const policy = this.policy;
    if (!meetingId || !policy || this.phase() !== 'joined' || this.lastReportedSpeaking === speaking) {
      return;
    }
    this.lastReportedSpeaking = speaking;
    this.speakingThrottle ??= new SpeakingThrottle(policy.speaking?.maxPerSecond ?? 1, value => this.rtc.speaking(meetingId, value));
    this.speakingThrottle.push(speaking);
  }

  /** Chat visto: el badge de no leídos se limpia (sala y mini-player). */
  markChatRead(): void {
    this.chatUnread.set(0);
  }

  /** F5 — una acción del menú del tile / panel de participantes, por nombre (un solo mapeo para sala y mini-player). */
  performHostAction(action: MeetingHostTileAction, targetUserId: string): void {
    switch (action) {
      case 'promote':
        return this.promoteCohost(targetUserId);
      case 'demote':
        return this.demoteCohost(targetUserId);
      case 'makeHost':
        return this.transferHost(targetUserId);
      case 'lowerHand':
        return this.lowerHand(targetUserId);
      case 'remove':
        return this.removeParticipant(targetUserId);
      case 'admit':
        return this.admit(targetUserId);
      case 'deny':
        return this.deny(targetUserId);
    }
  }

  private publishMediaStatus(): void {
    const meetingId = this.meetingId();
    if (meetingId) {
      this.rtc.mediaStatus(meetingId, this.audioEnabled(), this.videoEnabled(), this.screenSharing());
    }
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

  /** Una pista local cambió (cámara, micro, pantalla): aplicarla a cada enlace mesh o al producer SFU. */
  private async applyLocalTrack(source: LocalTrackSource, track: MediaStreamTrack | null): Promise<void> {
    this.syncFromSession();
    if (this.strategy() === 'Sfu') {
      const key: SfuProducerKey = source === 'microphone' ? 'audio' : source;
      await this.sfu.replaceTrack(key, track);
      return;
    }
    for (const conn of this.peerConns.values()) {
      await conn.link.replaceTrack(source, track);
    }
  }

  /**
   * Pide la capa de simulcast de un peer por FUENTE (solo SFU; no-op en mesh). Lo usa el driver de
   * "spotlight" del meeting-room: tile destacado = alta (spatial 2), thumbnails = baja (spatial 0).
   * La pantalla nunca se degrada. Fire-and-forget.
   */
  setPeerPreferredLayers(userId: string, source: 'camera' | 'screen', spatialLayer: number, temporalLayer?: number): void {
    if (this.strategy() !== 'Sfu') {
      return;
    }
    void this.sfu.setPeerPreferredLayers(userId, source, spatialLayer, temporalLayer);
  }

  // ---------- Screen share (sesión local → replaceTrack por peer / producer, sin renegociar) ----------

  /** `withAudio` (D-41): audio de la pantalla si el usuario lo pide y la política lo permite. */
  async startScreenShare(withAudio = false): Promise<void> {
    const meetingId = this.meetingId();
    const session = this.session;
    if (!meetingId || this.phase() !== 'joined' || !session || session.screenSharing()) {
      return;
    }
    const started = await session.startScreenShare({ withAudio: withAudio && (this.policy?.screenShare.audioAllowed ?? false) });
    if (!started) {
      return; // el usuario canceló el selector
    }
    this.syncFromSession();
    this.screenShareInterrupted.set(false);
    this.writeShareFlag(meetingId, true);
    this.sounds.play('screen-share', { isHost: this.isHost() });
    this.publishMediaStatus();
  }

  async stopScreenShare(): Promise<void> {
    await this.session?.stopScreenShare(); // `onScreenShareStopped` publica el estado
  }

  private onScreenShareStopped(): void {
    this.writeShareFlag(this.meetingId(), false);
    this.syncFromSession();
    this.publishMediaStatus();
  }

  /** El usuario acepta retomar la pantalla tras el re-join: abre el selector de nuevo. */
  async resumeSharing(): Promise<void> {
    this.screenShareInterrupted.set(false);
    await this.startScreenShare();
  }

  dismissResumeSharing(): void {
    this.screenShareInterrupted.set(false);
    this.writeShareFlag(this.meetingId(), false);
  }

  /**
   * Marca por pestaña de "estaba compartiendo" (sessionStorage): sobrevive a una recarga, no a cerrar
   * la pestaña. Envuelto en try/catch: puede no existir (ventana privada, tests).
   */
  private shareFlagKey(meetingId: string): string {
    return `taxvision.meeting.sharing:${meetingId}`;
  }

  private writeShareFlag(meetingId: string | null, sharing: boolean): void {
    if (!meetingId) {
      return;
    }
    try {
      if (sharing) {
        sessionStorage.setItem(this.shareFlagKey(meetingId), '1');
      } else {
        sessionStorage.removeItem(this.shareFlagKey(meetingId));
      }
    } catch {
      /* sin storage */
    }
  }

  private readShareFlag(meetingId: string): boolean {
    try {
      return sessionStorage.getItem(this.shareFlagKey(meetingId)) === '1';
    } catch {
      return false;
    }
  }

  // ---------- Calidad (T-48 / D-39 / D-40) y eco (T-68) ----------

  private startQualityMonitor(): void {
    const policy = this.policy;
    if (!policy || this.monitor) {
      return;
    }
    this.echo = policy.echo.detectionEnabled ? new EchoDetector(undefined, () => this.onEchoSuspected()) : null;
    this.monitor = new QualityMonitor({
      policy: policy.quality,
      sample: () => this.sampleStats(),
      isConnected: () => this.isMediaConnected(),
      onLevelChanged: (level, metrics) => this.onQualityChanged(level, metrics),
      onSample: reports => this.echo?.push(reports),
      onSustainedPoor: () => this.enterAudioOnly(),
      onRecovered: () => this.stepRecovery(),
    });
    this.monitor.start();
  }

  private async sampleStats(): Promise<RTCStatsReport[]> {
    if (this.strategy() === 'Sfu') {
      return this.sfu.collectStats();
    }
    return Promise.all([...this.peerConns.values()].map(c => c.link.collectStats()));
  }

  private isMediaConnected(): boolean {
    if (this.strategy() === 'Sfu') {
      return this.sfu.isConnected();
    }
    const links = [...this.peerConns.values()];
    return links.length === 0 || links.some(c => c.link.connectionState === 'connected');
  }

  /** Nivel propio: se refleja en mi tile y se manda al servidor SOLO al cambiar. */
  private onQualityChanged(level: ConnectionQuality, metrics: QualityMetrics | null): void {
    this.connectionQuality.set(level);
    this.connectionMetrics.set(metrics);
    const meetingId = this.meetingId();
    const me = this.myUserId();
    if (meetingId && this.phase() === 'joined') {
      this.rtc.connectionQuality(meetingId, level, metrics);
    }
    if (me) {
      this.participants.update(list => list.map(p => (p.userId === me ? { ...p, connectionQuality: level } : p)));
    }
  }

  /** Poor sostenido (D-40): pausar mi video para proteger el audio, sin tocar el estado del usuario. */
  private enterAudioOnly(): void {
    if (!this.session || this.degradeStep === 2) {
      return;
    }
    this.degradeStep = 2;
    this.session.pauseVideoForNetwork();
    if (this.strategy() === 'Sfu') {
      void this.sfu.setAudioOnly(true);
    }
    this.syncFromSession();
    this.toast.info('Video paused to protect audio');
  }

  /** Recuperación gradual: SFU 2 → capa media → completa; mesh reanuda de una. true = recuperado del todo. */
  private stepRecovery(): boolean {
    if (this.degradeStep === 0) {
      return true;
    }
    if (this.strategy() !== 'Sfu') {
      this.degradeStep = 0;
      this.session?.resumeVideoAfterNetwork();
      this.syncFromSession();
      return true;
    }
    if (this.degradeStep === 2) {
      this.degradeStep = 1;
      this.session?.resumeVideoAfterNetwork();
      this.syncFromSession();
      void this.sfu.setAudioOnly(false).then(() => this.sfu.setMaxSendSpatialLayer(1));
      return false;
    }
    this.degradeStep = 0;
    void this.sfu.setMaxSendSpatialLayer(TOP_SPATIAL_LAYER);
    return true;
  }

  private onEchoSuspected(): void {
    const policy = this.policy;
    if (!policy || !this.session) {
      return;
    }
    this.toast.info(ECHO_NOTICE);
    if (policy.echo.muteOnEcho && this.session.audioEnabled()) {
      void this.setAudioEnabled(false, 'echo');
    }
  }

  private toChatView(dto: MeetingChatMessageDto): MeetingChatMessage {
    const myId = this.myUserId();
    const fileId = !dto.isDeleted && dto.kind === 'Attachment' ? dto.attachmentFileId : null;
    if (fileId) this.resolveChatAttachment(fileId);
    return {
      id: dto.id,
      senderName: dto.senderDisplayName,
      text: dto.isDeleted ? '(message deleted)' : (dto.body ?? (fileId ? 'Shared a file' : '')),
      time: new Date(dto.createdAtUtc).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      isMine: !!myId && dto.senderId === myId,
      senderUserId: dto.senderId,
      createdAtUtc: dto.createdAtUtc,
      isEdited: dto.isEdited,
      editCount: dto.editCount ?? 0,
      isDeleted: dto.isDeleted,
      ...(fileId ? { attachment: { fileId, name: 'Attachment', size: '', ...this.attachmentNames.get(fileId) } } : {}),
      ...(dto.reactions?.length ? { reactions: dto.reactions } : {}),
    };
  }

  /** Nombre, tamaño y estado de moderación de un adjunto de la sala (CloudStorage), una vez por archivo. */
  private readonly attachmentNames = new Map<string, { name: string; size: string; status?: AttachmentScanState }>();
  private resolveChatAttachment(fileId: string): void {
    if (this.attachmentNames.has(fileId)) return;
    this.attachmentNames.set(fileId, { name: 'Attachment', size: '' });
    this.cloudStorage.getFile(fileId).subscribe({
      next: file => {
        const meta = { name: file.originalName, size: formatBytes(file.sizeBytes), status: moderationStateOf(file.status) };
        this.attachmentNames.set(fileId, meta);
        this.chatMessages.update(list => list.map(m => (m.attachment?.fileId === fileId ? { ...m, attachment: { fileId, ...meta } } : m)));
      },
      error: () => undefined,
    });
  }

  /** F8a (D-15): adjunto en el chat de la sala; los topes por minuto y por meeting los aplica el servidor. */
  async sendChatAttachment(file: File): Promise<void> {
    const meetingId = this.meetingId();
    const conversationId = this.conversationId();
    if (!meetingId || !conversationId || this.chatUploading()) return;
    this.chatUploading.set(true);
    try {
      const initiated = await firstValueFrom(
        this.cloudStorage.initiateUpload({
          originalName: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          ownerType: 'Communication',
          ownerId: conversationId,
          folderType: 'Other',
          taxYear: null,
        }),
      );
      await firstValueFrom(this.cloudStorage.uploadToPresignedUrl(initiated.uploadUrl, initiated.formData, file));
      await firstValueFrom(this.cloudStorage.completeUpload(initiated.fileId));
      this.attachmentNames.set(initiated.fileId, { name: file.name, size: formatBytes(file.size) });
      await this.rtc.chatSend(meetingId, null, initiated.fileId);
    } catch (err) {
      this.toast.error(meetingChatErrorMessage(socketErrorCode(err)) ?? "Couldn't send the file.");
    } finally {
      this.chatUploading.set(false);
    }
  }

  /** F8 (D-64): editar un mensaje propio de la sala. */
  editChatMessage(messageId: string, body: string): void {
    const meetingId = this.meetingId();
    const trimmed = body.trim();
    if (!meetingId || !trimmed) return;
    this.rtc
      .chatEdit(meetingId, messageId, trimmed)
      .catch(err => this.toast.error(editErrorMessage(socketErrorCode(err) ?? '') ?? "Couldn't edit the message."));
  }

  /** F8d: agrega o quita mi reacción; el estado llega con el evento (también el mío). */
  toggleChatReaction(messageId: string, emoji: string): void {
    const message = this.chatMessages().find(m => m.id === messageId);
    const add = !hasMyReaction(message?.reactions, emoji, this.myUserId());
    this.rtc.chatReact(messageId, emoji, add).catch((err: { code?: string }) => this.toast.error(reactionErrorText(err?.code)));
  }

  deleteChatMessage(messageId: string): void {
    const meetingId = this.meetingId();
    if (!meetingId) return;
    this.rtc.chatDelete(meetingId, messageId).catch(() => this.toast.error("Couldn't delete the message."));
  }

  /** Carga el historial previo del chat del meeting (el backend pagina DESC → se invierte a ASC). */
  private loadChatHistory(conversationId: string): void {
    const url = this.api.tenantUrl(`/communication/conversations/${conversationId}/messages`);
    this.http
      .get<{ items: MeetingChatMessageDto[]; editPolicy?: ChatEditPolicy }>(url, { params: new HttpParams().set('take', 50) })
      .subscribe({
        next: page => {
          this.chatEditPolicy.set(page.editPolicy ?? null);
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
    this.rtc
      .chatSend(meetingId, trimmed)
      .catch(err =>
        this.toast.error(
          isSocketRateLimited(socketErrorCode(err))
            ? SOCKET_RATE_LIMITED_MESSAGE
            : (meetingChatErrorMessage(socketErrorCode(err)) ?? 'Message could not be sent.'),
        ),
      );
  }

  // ---------- Grabación (con consentimiento) ----------

  requestRecording(): void {
    const meetingId = this.meetingId();
    if (!meetingId || this.phase() !== 'joined' || this.recordingState() !== 'Idle') {
      return;
    }
    this.rtc.requestRecording(meetingId).catch(err => {
      const code = socketErrorCode(err);
      this.toast.error(
        recordingStartErrorMessage(code) ?? (isSocketRateLimited(code) ? SOCKET_RATE_LIMITED_MESSAGE : 'Could not start recording.'),
      );
    });
  }

  /**
   * F7 — aplica `meeting.recording.state_changed`. Con `captureMode: 'Server'` el navegador NO mezcla
   * ni sube (el recorder captura del SFU); la mezcla local queda para `Client` o sin campo.
   */
  private applyRecordingState(dto: MeetingRecordingStateChangedDto): void {
    this.recordingState.set(dto.state);
    if (dto.captureMode !== undefined) {
      this.recordingCaptureMode.set(dto.captureMode);
    }
    if (dto.state === 'Recording') {
      this.recordingClock.start(dto.startedAtUtc, dto.maxDurationSeconds);
      if (usesClientCapture(dto) && this.isRecordingRequester() && this.policy && !this.recording.active) {
        const streams = [this.localStream(), ...[...this.peers().values()].map(p => p.cameraStream)];
        void this.recording.start(streams, this.policy.audio.clientRecordingKbps);
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
    if (dto.state === 'Idle') {
      this.recordingConsentFrom.set(null);
      this._recordingRequesterId.set(null);
    }
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
      void this.uploadRecording(meetingId, blob);
    }
  }

  private finalizeRecordingBackground(): void {
    const meetingId = this.meetingId();
    if (!this.isRecordingRequester() || !meetingId || !this.recording.active) {
      return;
    }
    void this.recording.stop().then(blob => {
      if (blob && blob.size > 0) {
        void this.uploadRecording(meetingId, blob);
      }
    });
  }

  private uploadRecording(meetingId: string, blob: Blob): Promise<void> {
    return this.recordingUpload.uploadAndAttach(meetingId, 'meeting-recording', blob, fileId => this.rtc.attachRecording(meetingId, fileId));
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
  /** F5 — bajar la mano de otro (host/cohost). La mía se baja con `toggleHandRaise`. */
  lowerHand(targetUserId: string): void {
    if (targetUserId === this.myUserId()) {
      if (this.handRaised()) {
        void this.toggleHandRaise();
      }
      return;
    }
    this.hostAction(id => this.rtc.lowerHand(id, targetUserId));
  }
  lowerAllHands(): void {
    this.hostAction(id => this.rtc.lowerAllHands(id));
  }

  /**
   * El estado real (lock/roles/admisión) llega por snapshot/participant.changed; acá solo se dispara y se
   * muestra el `code` del ack real con copy legible — sin inferir fracaso por timeout.
   */
  private hostAction(run: (meetingId: string) => Promise<unknown>): void {
    const meetingId = this.meetingId();
    if (!meetingId) {
      return;
    }
    run(meetingId).catch((err: { code?: string }) => this.toast.error(hostActionErrorMessage(err?.code)));
  }

  async leave(): Promise<void> {
    const meetingId = this.meetingId();
    // Si estoy grabando, capturo el blob ANTES de cortar las pistas (la subida va en background).
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
    if (this.phase() === 'joined') {
      this.sounds.play('leave', { isHost: this.isHost() });
    }
    // Reset LOCAL SINCRÓNICO (phase→'idle' YA): si el usuario le da a Join enseguida, el guard de join()
    // ya ve 'idle' y no queda ningún reset en vuelo que lo eche. El aviso de leave al backend va en background.
    this.reset();
    if (meetingId) {
      void this.rtc.leave(meetingId).catch(() => undefined);
      if (pendingBlob) {
        void this.uploadRecording(meetingId, pendingBlob);
      }
    }
  }

  /**
   * Termina el meeting PARA TODOS (solo host): `POST /communication/meetings/{id}/end` — el mismo
   * endpoint que usa la fila de la agenda — y luego sale localmente con `leave()`. Devuelve false si el
   * backend lo rechazó (se avisa con toast y se sigue dentro).
   */
  async endForAll(): Promise<boolean> {
    const meetingId = this.meetingId();
    if (!meetingId || !this.canEndForAll()) {
      return false;
    }
    try {
      await firstValueFrom(this.http.post(this.api.tenantUrl(`/communication/meetings/${meetingId}/end`), {}));
    } catch (err) {
      this.toast.error(toApiError(err).message);
      return false;
    }
    await this.leave();
    return true;
  }

  /**
   * Cierra una sesión que ya terminó por evento (phase 'ended': fin, cancelación, denegado o removido):
   * resetea a 'idle' sin avisar `meeting.leave` al backend (ya no hay a qué salir). No-op si no terminó.
   */
  closeEnded(): void {
    if (this.phase() === 'ended') {
      this.reset();
    }
  }

  /**
   * "Start a new meeting" (D-34, sin prórroga): tras un fin por tiempo/host, el host o cohost crea la
   * continuación (`POST /meetings/{id}/continue` → "X (cont.)" con los mismos invitados), la inicia
   * (`/start`) y entra con el flujo normal de join. Devuelve false si el backend lo rechazó (toast).
   */
  async startContinuation(): Promise<boolean> {
    const meetingId = this.meetingId();
    if (!meetingId || this.phase() !== 'ended' || !this.canEndForAll()) {
      return false;
    }
    const title = this.meetingTitle();
    let created: { meetingId: string };
    try {
      created = await firstValueFrom(
        this.http.post<{ meetingId: string }>(this.api.tenantUrl(`/communication/meetings/${meetingId}/continue`), {}),
      );
      await firstValueFrom(this.http.post(this.api.tenantUrl(`/communication/meetings/${created.meetingId}/start`), {}));
    } catch (err) {
      this.toast.error(toApiError(err).message);
      return false;
    }
    this.reset();
    await this.join(created.meetingId, `${title} (cont.)`);
    return true;
  }

  /**
   * Apaga cámara/micrófono (libera el hardware), el monitor de calidad y los enlaces/SFU, SIN tocar el
   * resto del estado ni la fase. Se llama cuando el meeting termina por EVENTO (Ended/Cancelled/Denied)
   * para que la cámara no quede encendida en la pantalla de "terminado". `reset()` lo repite (idempotente).
   */
  private stopLocalMedia(): void {
    this.monitor?.stop();
    this.monitor = null;
    this.echo = null;
    this.degradeStep = 0;
    this.sfu.leave();
    this.peerConns.forEach(conn => conn.link.close());
    this.peerConns.clear();
    this.mediaState.set('ok');
    // Salida real (leave, fin, expulsión): la marca de "estaba compartiendo" ya no aplica.
    if (this.screenSharing()) {
      this.writeShareFlag(this.meetingId(), false);
    }
    this.peers.set(new Map());
    this.session?.release();
    this.session = null;
    this.localStream.set(null);
    this.localScreenStream.set(null);
    this.screenSharing.set(false);
    this.screenAudioSharing.set(false);
    this.muteReason.set(null);
    this.videoPausedByNetwork.set(false);
    this.microphoneError.set(null);
    this.connectionQuality.set('Good');
    this.connectionMetrics.set(null);
  }

  private reset(): void {
    // Fin abrupto (meeting terminó, me sacaron) mientras grababa: rescatar lo grabado.
    this.finalizeRecordingBackground();
    this.stopLocalMedia();
    this.policy = null;
    this.chatMessages.set([]);
    this.chatEditPolicy.set(null);
    this.chatHistoryLoaded = false;
    this.iceServers = [];
    this.leftUserIds.clear();
    this.phase.set('idle');
    this.meetingId.set(null);
    this.meetingTitle.set('');
    this.conversationId.set(null);
    this.participants.set([]);
    this.yourRole.set('Attendee');
    this.hostUserId.set(null);
    this.strategy.set('Mesh');
    this.isLocked.set(false);
    this.stopClock();
    this.joinedAtMs = null;
    this.endsAtUtc.set(null);
    this.maxDurationMinutes.set(null);
    this.scheduledDurationMinutes.set(null);
    this.endReason.set(null);
    this.meetingEnded.set(false);
    this.durationWarning.set(null);
    this.audioEnabled.set(true);
    this.videoEnabled.set(true);
    this.handRaised.set(false);
    this.handRaisedAtUtc.set(null);
    this.desiredHand = false;
    this.handAckPending = false;
    this.chatUnread.set(0);
    this.reactions.set([]);
    this.reactionAnnouncement.set('');
    this.stopReactionSweep();
    this.speakingThrottle?.dispose();
    this.speakingThrottle = null;
    this.lastReportedSpeaking = null;
    this.screenShareInterrupted.set(false);
    this.pinnedUserId.set(null);
    this.recordingState.set('Idle');
    this.recordingCaptureMode.set(null);
    this.recordingClock.stop();
    this.recordingConsentFrom.set(null);
    this._recordingRequesterId.set(null);
    this.myUserId.set(null);
    this.isGuest.set(false);
    this.guestInvitationId = null;
  }
}

/** Solo los estados de moderación (T-20) cambian la tarjeta; escaneando sigue mostrándose como antes. */
function moderationStateOf(status: string): AttachmentScanState | undefined {
  switch (status) {
    case 'PendingReview':
    case 'BlockedByPolicy':
      return toAttachmentScanState(status);
    case 'Infected':
    case 'Deleted':
      return 'Unavailable';
    default:
      return undefined;
  }
}
