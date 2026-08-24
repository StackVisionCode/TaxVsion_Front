/**
 * Contratos del módulo Support contra Communication (`/communication/support`,
 * servicio Fastify/TS vía Gateway). Tipos espejo de `support.route.ts` (zod
 * `OpenBody`/`ListQuery`) y `support-queries.ts` (`SupportTicketDto`) del backend.
 */

/** Categorías aceptadas por el backend (zod enum en `OpenBody`). */
export type SupportCategory = 'Billing' | 'Technical' | 'Account' | 'Other';

export type SupportPriority = 'Low' | 'Normal' | 'High' | 'Urgent';

export type SupportStatus =
  | 'Open'
  | 'Claimed'
  | 'WaitingCustomer'
  | 'WaitingAgent'
  | 'Resolved'
  | 'Closed';

/** Espejo de `SupportTicketDto` del backend (fechas como ISO string). */
export interface SupportTicket {
  id: string;
  tenantId: string;
  agentTenantId: string;
  openedByUserId: string;
  assignedAgentId: string | null;
  conversationId: string;
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  openedAtUtc: string;
  claimedAtUtc: string | null;
  resolvedAtUtc: string | null;
  closedAtUtc: string | null;
}

/** Body de POST /communication/support. `priority` default 'Normal' en el backend. */
export interface OpenSupportTicketRequest {
  subject: string;
  category: SupportCategory;
  priority?: SupportPriority;
  /** La "descripción" del formulario: primer mensaje de la conversación del ticket (máx 4000). */
  initialMessage?: string;
}

/** Respuesta 201 de POST /communication/support. */
export interface OpenSupportTicketResult {
  ticketId: string;
  conversationId: string;
}

/** Respuesta 200 de POST /communication/support/:id/reopen. */
export interface ReopenSupportTicketResult {
  ticketId: string;
}

/** Respuesta de GET /communication/support (ListResult del backend). */
export interface PagedSupportTickets {
  items: SupportTicket[];
  page: number;
  size: number;
  totalCount: number;
}

/** Lo que emite el formulario de tickets (ui/). El store lo mapea al request real. */
export interface SupportTicketFormValue {
  subject: string;
  category: SupportCategory;
  description: string;
}

export interface SupportCategoryOption {
  value: SupportCategory;
  label: string;
}

/** Opciones del dropdown del formulario, con label amistoso por categoría del backend. */
export const SUPPORT_CATEGORY_OPTIONS: SupportCategoryOption[] = [
  { value: 'Technical', label: 'Technical issue' },
  { value: 'Billing', label: 'Billing' },
  { value: 'Account', label: 'Account' },
  { value: 'Other', label: 'Other' },
];

/**
 * El backend solo permite reopen desde estados terminales (`SupportTicket.reopen`
 * exige Resolved/Closed) y autoriza al opener, al agente asignado o a PlatformAdmin.
 * Como la lista "My tickets" solo trae tickets abiertos por el usuario actual,
 * alcanza con chequear el estado.
 */
export function canReopenTicket(ticket: SupportTicket): boolean {
  return ticket.status === 'Resolved' || ticket.status === 'Closed';
}
