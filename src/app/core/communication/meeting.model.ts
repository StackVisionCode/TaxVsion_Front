/**
 * Tipos socket de meetings — espejo de `contracts/socket/meeting-socket-events.ts`
 * del backend Communication. OJO: el `ActiveMeetingService` del Portal quedó
 * DESACTUALIZADO en `participant.changed` (leía campos planos + `connectionState`);
 * el contrato real anida `participant` con `status`. Acá se usa el contrato real.
 */

import type { ConnectionQuality } from './media/media-policy.model';

export type MeetingStrategy = 'Mesh' | 'Sfu';
export type MeetingRole = 'Host' | 'Cohost' | 'Attendee';
export type MeetingParticipantStatus = 'Waiting' | 'Joined' | 'Left' | 'Removed';
export type MeetingStatus = 'Scheduled' | 'Live' | 'Ended' | 'Cancelled' | 'Expired';
/** F3 — por qué terminó (lo pone el servidor). */
export type MeetingEndReason = 'Host' | 'MaxDurationReached' | 'NoParticipants' | 'Offboarding' | 'Backfill';

export interface MeetingParticipantDto {
  userId: string;
  displayName: string;
  /** F3 — 'TenantEmployee' | 'TenantAdmin' | 'CustomerPortal' | 'Guest'…: decide badges y elegibilidad a host/cohost. */
  actorType?: string;
  /**
   * Foto (`/storage/avatars/{id}`): llega en el snapshot y al entrar; ausente en los cambios de
   * media/mano/salida (conservar la conocida). null = sin foto.
   */
  avatarFileId?: string | null;
  role: MeetingRole;
  status: MeetingParticipantStatus;
  joinOrder: number;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  handRaised: boolean;
  /** F5 (D-49) — cuándo levantó la mano (ISO); null = mano baja. Ordena la cola de manos. */
  handRaisedAtUtc: string | null;
  /** F4 — última calidad reportada por ese participante (snapshot y `participant.changed`); ausente = desconocida. */
  connectionQuality?: ConnectionQuality | null;
}

/** F5 — ack de `meeting.raise_hand`. */
export interface MeetingRaiseHandAck {
  handRaised: boolean;
  handRaisedAtUtc: string | null;
}

/** F5 — `meeting.hand.lowered_by_host` (room de usuario del afectado). `all` = "Lower all". */
export interface MeetingHandLoweredByHostDto {
  meetingId: string;
  byUserId: string;
  all: boolean;
}

/** Ack de `meeting.rejoin` (reconexión transparente: la mano se conserva). */
export interface MeetingRejoinAck {
  snapshot: MeetingSnapshotDto;
}

/** F5 (D-50) — `meeting.reaction.received` (emisión volátil a la room). */
export interface MeetingReactionReceivedDto {
  meetingId: string;
  userId: string;
  displayName: string;
  emoji: string;
  at: string;
}

/** F4 — `meeting.participant.quality_changed` a la room. */
export interface MeetingParticipantQualityChangedDto {
  meetingId: string;
  userId: string;
  quality: ConnectionQuality;
}

export interface MeetingSnapshotDto {
  meetingId: string;
  status: MeetingStatus;
  strategy: MeetingStrategy;
  hostUserId: string;
  isLocked: boolean;
  participants: MeetingParticipantDto[];
  yourRole: MeetingRole;
  sequence: number;
  /** null mientras estás en la sala de espera (aún no admitido). */
  conversationId: string | null;
  /** F3 — informativa (la pidió el host al agendar). */
  scheduledDurationMinutes: number | null;
  /** F3 — tope de la oficina; el corte real es `endsAtUtc`. */
  maxDurationMinutes: number | null;
  /** F3 — instante del corte según el servidor (ISO); null = sin tope. */
  endsAtUtc: string | null;
  endReason: MeetingEndReason | null;
  continuationOfMeetingId: string | null;
}

export interface MeetingParticipantChangedDto {
  meetingId: string;
  participant: MeetingParticipantDto;
  sequence: number;
}

export interface MeetingStateDto {
  meetingId: string;
  status: MeetingStatus;
  isLocked: boolean;
  hostUserId: string;
  sequence: number;
  /** F3 — presente cuando `status` es Ended. */
  endReason?: MeetingEndReason | null;
}

/** F3 — `meeting.duration.warning`: una vez por umbral (600/300/60 s) a la room del meeting. */
export interface MeetingDurationWarningDto {
  meetingId: string;
  remainingSeconds: number;
  endsAtUtc: string;
}

/**
 * F3 — `meeting.host.changed`: llega DESPUÉS de los dos `participant.changed` (saliente Cohost, entrante
 * Host) y ANTES del `state.changed` con el `hostUserId` real.
 */
export interface MeetingHostChangedDto {
  meetingId: string;
  previousHostUserId: string;
  newHostUserId: string;
  reason: 'Transfer' | 'Succession' | 'Offboarding';
}

export type MeetingYouRemovedReason = 'Grace' | 'Revoked' | 'Expired' | 'Offboarding' | 'MeetingEnded' | 'RemovedByHost';

/** F3 — `meeting.you.removed`: el servidor sacó a ESTE socket; salir localmente sin `meeting.leave`. */
export interface MeetingYouRemovedDto {
  meetingId: string;
  reason: MeetingYouRemovedReason;
}

/** F3 — `meeting.ended` (room de usuario, para las listas) ahora con motivo. */
export interface MeetingEndedDto {
  meetingId: string;
  reason: MeetingEndReason | 'Expired';
}

export interface MeetingParticipantDeniedDto {
  meetingId: string;
  participantUserId: string;
  deniedByUserId: string;
  deniedAtUtc: string;
}

export interface MeetingCancelledDto {
  meetingId: string;
  cancelledByUserId: string;
  reason: string | null;
  cancelledAtUtc: string;
}

/** Señalización mesh (3B). */
export interface MeetingSignalDto {
  meetingId: string;
  fromPeerUserId: string;
  kind: 'offer' | 'answer' | 'ice';
  data: Record<string, unknown>;
}

/** SFU (mediasoup, >4 participantes) — eventos server→cliente. */
export interface SfuNewProducerDto {
  meetingId: string;
  userId: string;
  producerId: string;
  kind: 'audio' | 'video';
  /** 'camera' (default) o 'screen' — un participante puede producir cámara Y pantalla a la vez. */
  source?: 'camera' | 'screen';
}
export interface SfuProducerClosedDto {
  meetingId: string;
  userId: string;
  producerId: string;
}
export interface SfuRemoteProducer {
  userId: string;
  producerId: string;
  kind: 'audio' | 'video';
  source?: 'camera' | 'screen';
}

/**
 * Ack de meeting.join. `requiresAdmission` decide sala de espera vs entrar directo.
 * Para el join DIRECTO (sin admisión) el backend NO emite el evento `meeting.snapshot`:
 * el snapshot autoritativo (participantes, rol, estrategia, conversationId) viene INLINE
 * acá, así que el cliente debe aplicarlo del ack. El evento solo se emite al ADMITIR
 * desde la sala de espera. `iceServers` se incluye por paridad con el backend/Portal
 * (el CRM autenticado igual puede seguir usando el fetch HTTP de ICE).
 */
export interface MeetingJoinAck {
  requiresAdmission: boolean;
  snapshot: MeetingSnapshotDto;
  /** F5 (D-49) — este join es un re-join completo (recarga / sesión nueva) de alguien que ya estaba. */
  rejoined?: boolean;
  /** F5 (D-49) — el re-join completo bajó la mano que tenía levantada: se avisa con toast. */
  handLoweredOnRejoin?: boolean;
  iceServers?: { iceServers: { urls: string | string[]; username?: string; credential?: string }[]; expiresAtUtc: string };
}

export interface MeetingJoinOptions {
  passcode?: string;
  invitationToken?: string;
  /** F6 — invitado externo (socket con `auth.ticket`): su userId es `guest:{guestInvitationId}`. */
  guestInvitationId?: string;
  audioDefault?: boolean;
  videoDefault?: boolean;
}

export type MeetingRecordingState =
  | 'Idle'
  | 'Requesting'
  | 'Recording'
  | 'Stopping'
  | 'Processing'
  | 'Ready'
  | 'Failed';

export interface MeetingRecordingConsentRequestedDto {
  meetingId: string;
  requestedByUserId: string;
  requestedAtUtc: string;
}

export interface MeetingRecordingConsentRecordedDto {
  meetingId: string;
  userId: string;
  response: 'Accepted' | 'Rejected';
  respondedAtUtc: string;
}

export interface MeetingRecordingStateChangedDto {
  meetingId: string;
  state: MeetingRecordingState;
  updatedAtUtc: string;
}

/** Mensaje del chat del meeting (`meeting.chat.message.new`) — mismo shape que MessageDto. */
export interface MeetingChatMessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  senderDisplayName: string;
  kind: 'Text' | 'Attachment' | 'System';
  body: string | null;
  attachmentFileId: string | null;
  createdAtUtc: string;
  isEdited: boolean;
  isDeleted: boolean;
}
