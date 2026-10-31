export type ConversationKind = 'Direct' | 'Group' | 'Support' | 'Meeting';

export interface ConversationParticipant {
  userId: string;
  displayName: string;
  isPrimaryPreparer: boolean;
  /** Foto (`/storage/avatars/{id}`). Ausente = no se resolvió (conservar la conocida); null = sin foto. */
  avatarFileId?: string | null;
}

/** Participante tal como lo guarda la vista (nombre + foto, actualizable en vivo). */
export interface ChatParticipant {
  userId: string;
  displayName: string;
  /** undefined = desconocida todavía; null = sin foto. */
  avatarFileId?: string | null;
}

/** Payload de `chat.conversation.participant_added` (alguien sumó un miembro a un grupo). */
export interface ConversationParticipantAddedDto {
  conversationId: string;
  addedByUserId: string;
  newParticipantUserId: string;
  newParticipantDisplayName: string;
  /** Ausente si no se pudo resolver; null = sin foto. */
  newParticipantAvatarFileId?: string | null;
  addedAtUtc: string;
}

/** Fila de GET /communication/conversations. Sin preview de último mensaje — el backend no lo incluye. */
export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  title: string | null;
  lastMessageAtUtc: string | null;
  updatedAtUtc: string;
  participants: ConversationParticipant[];
  unreadCount: number;
}

export interface PagedConversations {
  items: ConversationSummary[];
  page: number;
  size: number;
  totalCount: number;
}

export type MessageKind = 'Text' | 'Attachment' | 'System';

/** Espejo de MessageDto (chat-socket-events.ts / get-messages.ts en Communication). */
export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  senderDisplayName: string;
  /** Foto del remitente: solo en el historial (en `chat.message.new` no viene → se toma de los participantes). */
  senderAvatarFileId?: string | null;
  kind: MessageKind;
  body: string | null;
  attachmentFileId: string | null;
  replyToMessageId: string | null;
  forwardedFromMessageId: string | null;
  isEdited: boolean;
  isDeleted: boolean;
  isPinned: boolean;
  pinnedAtUtc: string | null;
  pinnedByUserId: string | null;
  createdAtUtc: string;
  editedAtUtc: string | null;
  /** Cotejos del emisor sobre SU mensaje: null=enviado (1 gris), fecha=entregado (2 grises)/leído (2 azules). */
  deliveredAtUtc?: string | null;
  readAtUtc?: string | null;
  /** Nota de voz (adjunto de audio): duración en ms y waveform (picos 0-100). null en otros mensajes. */
  audioDurationMs?: number | null;
  audioWaveform?: number[] | null;
  /** F7 (D-27) — transcript de la nota de voz (≤ 4000) y su estado; null en otros mensajes. */
  transcriptText?: string | null;
  transcriptState?: string | null;
}

/** F7 — estado del transcript de una nota de voz (`Skipped` = no se transcribe: apagado o muy larga). */
/** NotRequested = se puede transcribir con el botón "Transcribe" (no se transcribe al enviar). */
export type VoiceNoteTranscriptState = 'NotRequested' | 'Processing' | 'Ready' | 'Failed' | 'Skipped';

/** F7 — `chat.message.transcript_updated` (a la sala de la conversación). */
export interface MessageTranscriptUpdatedDto {
  conversationId: string;
  messageId: string;
  transcriptState: VoiceNoteTranscriptState;
  transcriptText: string | null;
  /** Alias del borrador de la spec (§4.7); manda `transcriptState`. */
  state?: VoiceNoteTranscriptState;
}

/** F7 — `GET /communication/conversations/{id}/messages/search?q&limit` (incluye transcripts de notas de voz). */
export interface MessageSearchResponse {
  items: MessageDto[];
  limit: number;
  truncated: boolean;
}

/** Normaliza el estado del transcript que trae el DTO (desconocido = sin transcript). */
export function toVoiceNoteTranscriptState(value: string | null | undefined): VoiceNoteTranscriptState | null {
  return value === 'NotRequested' || value === 'Processing' || value === 'Ready' || value === 'Failed' || value === 'Skipped'
    ? value
    : null;
}

/** Cotejo de entrega (2 grises): el otro recibió hasta `upToMessageId` (sin abrir el chat). */
export interface DeliveryReceiptDto {
  conversationId: string;
  userId: string;
  upToMessageId: string;
  deliveredAtUtc: string;
}

/** GET /communication/conversations/:id/messages — paginación por cursor, no por página. */
export interface MessagesPage {
  items: MessageDto[];
  nextBeforeUtc: string | null;
  nextAfterUtc: string | null;
}

export interface ReadReceiptDto {
  conversationId: string;
  userId: string;
  lastReadMessageId: string;
  readAtUtc: string;
}

export interface TypingDto {
  conversationId: string;
  userId: string;
  displayName: string;
}

export type PresenceStatus = 'Online' | 'Busy' | 'Offline';
export type PresenceBusyReason = 'Call' | 'Meeting' | null;

export interface PresenceChangedDto {
  userId: string;
  status: PresenceStatus;
  busyReason: PresenceBusyReason;
  changedAtUtc: string;
}

/** Etiqueta legible del estado de presencia (nunca solo color — ver a11y). */
export function presenceLabel(status: PresenceStatus, busyReason: PresenceBusyReason): string {
  if (status === 'Online') {
    return 'Online';
  }
  if (status === 'Busy') {
    return busyReason === 'Call' ? 'In a call' : busyReason === 'Meeting' ? 'In a meeting' : 'Busy';
  }
  return 'Offline';
}

export function presenceDotClass(status: PresenceStatus): string {
  return status === 'Online' ? 'bg-emerald-500' : status === 'Busy' ? 'bg-amber-500' : 'bg-gray-300';
}

export function presenceTextClass(status: PresenceStatus): string {
  return status === 'Online' ? 'text-emerald-600' : status === 'Busy' ? 'text-amber-600' : 'text-gray-400';
}

export interface MessageEditedDto {
  messageId: string;
  conversationId: string;
  body: string;
  editedAtUtc: string;
}

export interface MessageDeletedDto {
  messageId: string;
  conversationId: string;
  deletedAtUtc: string;
}

/** Fila de GET /communication/directory/employees?q=&limit=. */
export interface EmployeeDirectoryEntry {
  userId: string;
  displayName: string;
  email: string;
  isActive: boolean;
  actorType: string;
  /** Foto del empleado; null = sin foto. */
  avatarFileId?: string | null;
}

/**
 * Fila de POST /communication/directory/customers/search ({ q, limit }).
 * `portalUserId` es el userId de Auth de la cuenta de portal activa del cliente
 * (el id que pide `chat.conversation.start_direct`), o null si el cliente todavía
 * no activó el portal — en ese caso NO es chateable.
 */
export interface CustomerDirectoryEntry {
  customerId: string;
  displayName: string;
  email: string;
  isActive: boolean;
  portalUserId: string | null;
  /** Foto de la ficha del cliente; null = sin foto. */
  avatarFileId?: string | null;
}

/** Payload de chat.message.attachment_flagged — CloudStorage marcó el adjunto como no disponible. */
export interface AttachmentFlaggedDto {
  messageId: string;
  conversationId: string;
  fileId: string;
  status: 'Infected' | 'Deleted' | 'BlockedByPolicy';
  flaggedAtUtc: string;
}

// SocketEnvelope<T> y SocketAck<T> son transversales: viven en core/realtime y se
// re-exportan acá para no romper los imports existentes del feature de chat.
export type { SocketAck, SocketEnvelope } from '@core/realtime/realtime.model';
