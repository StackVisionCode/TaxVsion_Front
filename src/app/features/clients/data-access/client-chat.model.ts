/**
 * Contrato mínimo de `GET /communication/directory/customers?q=&limit=` (Communication.Api vía
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
