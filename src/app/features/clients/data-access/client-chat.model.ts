/**
 * Contrato mínimo de `POST /communication/directory/customers/search` (Communication.Api vía
 * Gateway) para la tarjeta "Chat" del tab Communication del perfil.
 *
 * El shape se replica acá a propósito (en vez de importar de `features/chat`) para no acoplar dos
 * features — mismo criterio que `client-communication.model.ts` / `client-notes.model.ts`.
 *
 * `portalUserId` es el userId de Auth de la cuenta de portal ACTIVA del cliente (el id que
 * `chat.conversation.start_direct` necesita), o null si el cliente todavía no activó el portal —
 * en ese caso NO es chateable y la tarjeta ofrece invitar al portal en su lugar.
 */
export interface ClientChatDirectoryEntry {
  customerId: string;
  displayName: string;
  email: string;
  isActive: boolean;
  portalUserId: string | null;
}

/**
 * Chat del cliente que se cerró al retirarse su preparador (`GET /communication/customers/{id}/closed-chats`).
 * Queda en solo lectura: la oficina con acceso al cliente lee el historial.
 */
export interface ClosedClientChat {
  conversationId: string;
  formerStaffUserId: string;
  formerStaffDisplayName: string;
  closedAtUtc: string;
  lastMessageAtUtc: string | null;
}

/** Lo mínimo de un mensaje del historial para leerlo (`GET /communication/conversations/{id}/messages`). */
export interface ClosedChatMessage {
  id: string;
  senderId: string;
  senderDisplayName: string;
  kind: 'Text' | 'Attachment' | 'System';
  body: string | null;
  createdAtUtc: string;
}

export interface ClosedChatMessagesPage {
  items: ClosedChatMessage[];
  nextBeforeUtc: string | null;
}
