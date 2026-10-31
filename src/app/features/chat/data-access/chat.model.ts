import type { ChatEditPolicy, ChatParticipant, ChatReactionPolicy, GroupRole, MessageEditsDto, MessageReactionSummary, VoiceNoteTranscriptState } from '@shared/ui/chat/chat-message.model';
export type { ChatParticipant, GroupRole, MessageEditsDto, VoiceNoteTranscriptState } from '@shared/ui/chat/chat-message.model';
export type ConversationKind = 'Direct' | 'Group' | 'Support' | 'Meeting';

export interface ConversationParticipant {
  userId: string;
  displayName: string;
  isPrimaryPreparer: boolean;
  /** Foto (`/storage/avatars/{id}`). Ausente = no se resolvió (conservar la conocida); null = sin foto. */
  avatarFileId?: string | null;
  /** F8b (D-22). */
  role?: GroupRole;
  actorType?: string;
}

/** Participante tal como lo guarda la vista (nombre + foto, actualizable en vivo). */

/** Payload de `chat.conversation.participant_added` (alguien sumó un miembro a un grupo). */
export interface ConversationParticipantAddedDto {
  conversationId: string;
  addedByUserId: string;
  newParticipantUserId: string;
  newParticipantDisplayName: string;
  /** Ausente si no se pudo resolver; null = sin foto. */
  newParticipantAvatarFileId?: string | null;
  /** F8b: cliente vs staff. */
  newParticipantActorType?: string;
  addedAtUtc: string;
}

/** F8b: `chat.conversation.participant_removed` (salió, lo sacaron o se dio de baja). */
export interface ConversationParticipantRemovedDto {
  conversationId: string;
  removedByUserId: string;
  removedParticipantUserId: string;
  reason: 'Left' | 'Kicked';
  removedAtUtc: string;
}

/** F8b (D-22): `chat.conversation.participant_role_changed`; `changedByUserId` null = sucesión automática. */
export interface ConversationParticipantRoleChangedDto {
  conversationId: string;
  userId: string;
  role: GroupRole;
  changedByUserId: string | null;
  changedAtUtc: string;
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
  /** F8b: datos del grupo (T-21), modo anuncio (D-23), archivado y estado propio. Ausentes en backends viejos. */
  description?: string | null;
  avatarFileId?: string | null;
  adminsOnlyWrite?: boolean;
  isArchived?: boolean;
  isMuted?: boolean;
  myRole?: GroupRole | null;
}

export interface PagedConversations {
  items: ConversationSummary[];
  page: number;
  size: number;
  totalCount: number;
  /** F8a: no leídos por tipo en todas las conversaciones activas (badges de Chat y Support). */
  unreadByKind?: UnreadByKind;
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
  /** F8a (T-10): tipo del chat en `chat.message.new`; el módulo Chat solo toma Direct/Group. */
  conversationKind?: ConversationKind;
  /** F8a: meeting dueño cuando el chat es de una sala. */
  meetingId?: string | null;
  kind: MessageKind;
  body: string | null;
  attachmentFileId: string | null;
  replyToMessageId: string | null;
  forwardedFromMessageId: string | null;
  isEdited: boolean;
  /** F8: cuántas veces se editó (backends viejos no lo mandan). */
  editCount?: number;
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
  /** F8d (T-26): solo en el historial; en vivo llegan `chat.message.reaction.*`. */
  reactions?: MessageReactionSummary[];
}

/** F7 — estado del transcript de una nota de voz (`Skipped` = no se transcribe: apagado o muy larga). */
/** NotRequested = se puede transcribir con el botón "Transcribe" (no se transcribe al enviar). */

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
  /** F8: ventana de edición de este chat (por tipo); el servidor manda. */
  editPolicy?: ChatEditPolicy;
  /** F8a: de qué es el chat (el deep link lleva Support/Meeting a su módulo) y si está archivado (solo lectura). */
  conversation?: ConversationMeta;
  /** F8d (D-24, T-24): tope de emojis por persona y catálogo curado. */
  reactionPolicy?: ChatReactionPolicy;
}

/** F8a — tipo, estado y dueño de una conversación (llega con su historial). */
export interface ConversationMeta {
  id: string;
  kind: ConversationKind;
  isArchived: boolean;
  meetingId: string | null;
  supportTicketId: string | null;
}

/** F8a — `chat.conversation.updated` (campos ausentes = sin cambio). */
export interface ConversationUpdatedDto {
  conversationId: string;
  kind: ConversationKind;
  isArchived?: boolean;
  title?: string | null;
  description?: string | null;
  avatarFileId?: string | null;
  adminsOnlyWrite?: boolean;
  /** Solo a mis pestañas: silencio propio. */
  isMuted?: boolean;
}

/** F8a — no leídos por tipo de chat (badges de Chat y de Support). */
export type UnreadByKind = Record<ConversationKind, number>;


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
  /** F8: total de ediciones tras esta. */
  editCount?: number;
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
  /** F8c: por qué no se puede abrir un chat (mismas reglas que start_direct); null/ausente = se puede. */
  chatBlockedReason?: ChatBlockedReason | null;
}

/** F8c: motivo por el que una fila del directorio no es chateable. */
export type ChatBlockedReason = 'EmployeeToEmployeeDisabled' | 'NoPortalAccount';

/** F8c (T-14): página del directorio del rail (cursor opaco; null = no hay más). */
export interface DirectoryPage<T> {
  items: T[];
  nextCursor: string | null;
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
  /** F8c: `NoPortalAccount` si no activó su portal. */
  chatBlockedReason?: ChatBlockedReason | null;
}

/**
 * Payload de chat.message.attachment_flagged — CloudStorage cambió el estado del adjunto.
 * T-20: PendingReview = en revisión de contenido; Available = el revisor lo aprobó.
 */
export interface AttachmentFlaggedDto {
  messageId: string;
  conversationId: string;
  fileId: string;
  status: 'Infected' | 'Deleted' | 'BlockedByPolicy' | 'PendingReview' | 'Available';
  flaggedAtUtc: string;
}

// SocketEnvelope<T> y SocketAck<T> son transversales: viven en core/realtime y se
// re-exportan acá para no romper los imports existentes del feature de chat.
export type { SocketAck, SocketEnvelope } from '@core/realtime/realtime.model';

/** F8b (T-21) — URL presignada para subir la foto del grupo directo a MinIO. */
export interface GroupAvatarUpload {
  fileId: string;
  uploadUrl: string;
  formData: Record<string, string>;
  expiresAtUtc: string;
}

/** F8b (T-22) — una fila de la bitácora del grupo. */
export interface GroupActivityItem {
  id: string;
  action:
    | 'GroupCreated'
    | 'MemberAdded'
    | 'MemberRemoved'
    | 'MemberLeft'
    | 'RoleChanged'
    | 'OwnershipTransferred'
    | 'InfoUpdated'
    | 'AdminsOnlyChanged'
    | 'Archived';
  actorUserId: string | null;
  targetUserId: string | null;
  /** Nombres resueltos por el servidor (también de quien ya salió del grupo). */
  actorDisplayName?: string | null;
  targetDisplayName?: string | null;
  metadata: Record<string, unknown> | null;
  occurredAtUtc: string;
}

export interface GroupActivityPage {
  items: GroupActivityItem[];
  nextBeforeUtc: string | null;
}

/** F8d: `chat.message.reaction.added` / `.removed`. */
export interface MessageReactionChangedDto {
  messageId: string;
  conversationId: string;
  userId: string;
  emoji: string;
}

/** F8d: los contratos de adjuntos viven con su servicio en core (también los usa la sala de reuniones). */
export type { AttachmentMetaDto, InitiatedAttachmentUpload } from '@core/communication/conversation-attachments.service';

/** F8d (ADD-01 §13): pestañas de Info. */
export type ConversationContentTab = 'Media' | 'Documents' | 'Audio' | 'Links';

export type ConversationContentItem =
  | {
      kind: 'Attachment';
      fileId: string;
      messageId: string;
      senderId: string;
      category: string;
      contentType: string | null;
      fileName: string | null;
      sizeBytes: number | null;
      status: string;
      createdAtUtc: string;
    }
  | { kind: 'Link'; id: string; messageId: string; senderId: string; url: string; domain: string; createdAtUtc: string };

export interface ConversationContentPage {
  items: ConversationContentItem[];
  nextBefore: string | null;
}
