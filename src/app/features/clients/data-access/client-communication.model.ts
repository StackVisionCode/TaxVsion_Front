import { parseUtcDate } from '../../../shared/utils/utc-date.util';

/**
 * Contrato de `ThreadsController` (`/correspondence`, servicio Correspondence.Api vía
 * Gateway) para la pestaña "Communication" del perfil de cliente.
 *
 * ✅ Este SÍ es un listado filtrado por cliente de verdad:
 * `GET /correspondence/customers/{customerId}/threads` cuelga los hilos de email de un
 * customer concreto (el inbox de Correspondence es customer-céntrico por diseño; no
 * existe una "bandeja global" del tenant). Por eso esta pestaña muestra datos reales.
 *
 * ⚠️ Alcance: SOLO EMAIL. El mock que reemplaza mezclaba llamadas y SMS en el mismo
 * timeline; ninguno de esos dos canales tiene servicio detrás:
 *  - Llamadas: el Communication service sí registra llamadas WebRTC in-app, pero `Call`
 *    no tiene `CustomerId` (participantes = UserIds de Auth) y el historial siempre
 *    devuelve las llamadas del usuario del JWT. Ver la pestaña "Calls", vacía por eso.
 *  - SMS: hay un servicio de SMS saliente (Twilio como proveedor), pero no expone un
 *    historial de mensajes por customer.
 * Se declara en pantalla en vez de fingir un filtro por canal que no existe.
 *
 * El shape se replica acá a propósito (en vez de importar de `features/mail`) para no
 * acoplar dos features entre sí — mismo criterio que `client-notes.model.ts`.
 * Los enums viajan como STRING y las fechas como ISO UTC.
 */

/** Espejo de TaxVision.Correspondence.Domain.Inbox.EmailThreadStatus. */
export type ClientThreadStatus = 'Active' | 'Archived';

/**
 * Fila de GET /correspondence/customers/{customerId}/threads (espejo de `ThreadSummary`).
 * El backend NO devuelve `customerId` acá (ya viene en la ruta) ni `providerThreadId`.
 */
export interface ClientThreadSummary {
  threadId: string;
  subject: string;
  status: ClientThreadStatus;
  messageCount: number;
  firstMessageAtUtc: string;
  lastMessageAtUtc: string;
}

/** `size` del controller: fuera de rango cae a 20, así que se pide explícito. */
export const CLIENT_THREADS_PAGE_SIZE = 50;

export type ClientThreadStatusFilter = 'all' | ClientThreadStatus;

/** Filtros por el estado REAL del hilo (no por canal: el único canal es email). */
export const CLIENT_THREAD_STATUS_FILTERS: { value: ClientThreadStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'Active', label: 'Active' },
  { value: 'Archived', label: 'Archived' },
];

/** Fila lista para pintar: solo derivados del DTO, sin nada inventado. */
export interface ClientEmailThreadRow {
  id: string;
  subject: string;
  status: ClientThreadStatus;
  statusLabel: string;
  statusChip: string;
  statusDot: string;
  messageCount: number;
  messageCountLabel: string;
  /** Instante del último mensaje, en ms, para ordenar de más reciente a más antiguo. */
  lastMessageTime: number;
  lastMessageLabel: string;
  firstMessageLabel: string;
}

/** "Jun 28, 2026 · 9:42 AM" — el backend de Correspondence manda UTC sin `Z`, de ahí parseUtcDate. */
export function formatThreadInstant(iso: string): string {
  const date = parseUtcDate(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

export function toClientEmailThreadRow(thread: ClientThreadSummary): ClientEmailThreadRow {
  const archived = thread.status === 'Archived';
  const lastDate = parseUtcDate(thread.lastMessageAtUtc);
  return {
    id: thread.threadId,
    // El asunto puede llegar vacío si el email original no traía Subject.
    subject: thread.subject?.trim() ? thread.subject : '(no subject)',
    status: thread.status,
    statusLabel: archived ? 'Archived' : 'Active',
    statusChip: archived ? 'border-gray-300 text-gray-500' : 'border-indigo-200 text-indigo-600',
    statusDot: archived ? 'bg-gray-400' : 'bg-indigo-500',
    messageCount: thread.messageCount,
    messageCountLabel: `${thread.messageCount} ${thread.messageCount === 1 ? 'message' : 'messages'}`,
    lastMessageTime: Number.isNaN(lastDate.getTime()) ? 0 : lastDate.getTime(),
    lastMessageLabel: formatThreadInstant(thread.lastMessageAtUtc),
    firstMessageLabel: formatThreadInstant(thread.firstMessageAtUtc),
  };
}
