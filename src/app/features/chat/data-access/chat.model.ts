export type ConversationKind = 'Direct' | 'Group' | 'Support' | 'Meeting';

export interface ConversationParticipant {
  userId: string;
  displayName: string;
  isPrimaryPreparer: boolean;
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

export interface PresenceChangedDto {
  userId: string;
  status: PresenceStatus;
  busyReason: 'Call' | 'Meeting' | null;
  changedAtUtc: string;
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
}

/** Payload de chat.message.attachment_flagged — CloudStorage marcó el adjunto como no disponible. */
export interface AttachmentFlaggedDto {
  messageId: string;
  conversationId: string;
  fileId: string;
  status: 'Infected' | 'Deleted' | 'BlockedByPolicy';
  flaggedAtUtc: string;
}

/** Sobre de ack de todos los comandos Socket.IO (send/edit/delete/markRead/...). */
export type SocketAck<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

/** Sobre de todo evento server->client (chat-socket-events.ts SocketEnvelope<T>). */
export interface SocketEnvelope<T> {
  eventId: string;
  correlationId: string;
  emittedAtUtc: string;
  sequence?: number;
  payload: T;
}
