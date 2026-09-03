/**
 * Tipos socket de meetings — espejo de `contracts/socket/meeting-socket-events.ts`
 * del backend Communication. OJO: el `ActiveMeetingService` del Portal quedó
 * DESACTUALIZADO en `participant.changed` (leía campos planos + `connectionState`);
 * el contrato real anida `participant` con `status`. Acá se usa el contrato real.
 */

export type MeetingStrategy = 'Mesh' | 'Sfu';
export type MeetingRole = 'Host' | 'Cohost' | 'Attendee';
export type MeetingParticipantStatus = 'Waiting' | 'Joined' | 'Left' | 'Removed';
export type MeetingStatus = 'Scheduled' | 'Live' | 'Ended' | 'Cancelled';

export interface MeetingParticipantDto {
  userId: string;
  displayName: string;
  role: MeetingRole;
  status: MeetingParticipantStatus;
  joinOrder: number;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  handRaised: boolean;
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
}

/** Ack de meeting.join — `requiresAdmission` decide sala de espera vs entrar directo. */
export interface MeetingJoinAck {
  requiresAdmission: boolean;
}

export interface MeetingJoinOptions {
  passcode?: string;
  invitationToken?: string;
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
