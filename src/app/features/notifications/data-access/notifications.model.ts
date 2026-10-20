import type {
  AppNotification,
  NotificationType,
} from '../ui/notification-list/notification-list.component';
import { parseUtcDate } from '@shared/utils/utc-date.util';
import { notificationRelativeTime, notificationText } from './notification-i18n';

/**
 * Contratos del backend de notificaciones (Communication, Fastify/TS vía
 * Gateway — ver notifications.route.ts + notification-queries.ts en
 * Services/Communication). Endpoints HTTP reales:
 *
 * - GET  /communication/notifications?page&size[&unreadOnly] → NotificationListResult
 * - GET  /communication/notifications/unread-count           → { count, asOfUtc }
 * - POST /communication/notifications/{id}/read              → MarkNotificationReadResult
 * - POST /communication/notifications/read-all               → MarkAllNotificationsReadResult
 * - POST /communication/notifications/mark-many-read         → BulkNotificationResult
 * - POST /communication/notifications/mark-many-unread       → BulkNotificationResult
 * - POST /communication/notifications/delete-many            → BulkNotificationResult
 */

export type NotificationPriority = 'Low' | 'Normal' | 'High' | 'Urgent';

/** Fila de notificación tal como la serializa el backend (NotificationDto). */
export interface NotificationDto {
  id: string;
  /** Nombre de evento con puntos: signature.*, cloudstorage.*, customer.*, connectors.* */
  kind: string;
  priority: NotificationPriority;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  category: string | null;
  actorUserId: string | null;
  actorDisplayName: string | null;
  /**
   * "System" | "TenantEmployee" | "TenantAdmin" | "CustomerPortal" | "External".
   * Permite al UI distinguir "lo hizo el sistema" (sin avatar interno, badge
   * neutral) de "lo hizo un usuario real". Null para notificaciones legacy
   * pre-contrato — el UI cae al heurístico por kind/priority.
   */
  actorType: string | null;
  resourceType: string | null;
  resourceId: string | null;
  resourceContext: Record<string, string>;
  titleKey: string | null;
  bodyKey: string | null;
  params: Record<string, string>;
  action: string | null;
  groupKey: string | null;
  occurredAtUtc: string | null;
  /** ISO 8601 UTC. */
  createdAtUtc: string;
  /** ISO 8601 UTC o null si no está leída. */
  readAtUtc: string | null;
}

/** Envelope de GET /communication/notifications/since?sinceUtc=X&limit=Y — resync tras corte de socket. */
export interface NotificationsSinceResult {
  items: NotificationDto[];
  unreadCount: number;
  asOfUtc: string;
  /** `createdAtUtc` del último item devuelto (ISO) o null si items vacío. Cursor implícito. */
  nextCursorUtc: string | null;
}

/** Envelope de GET /communication/notifications. */
export interface NotificationListResult {
  items: NotificationDto[];
  page: number;
  size: number;
  /** Total de filas que cumplen el filtro actual (`unreadOnly`): para "Page X of Y". */
  total: number;
  /** Conteo de no-leídas del usuario en TODO el tenant (no solo esta página). */
  unreadCount: number;
  asOfUtc: string;
}

/** Resultado común de los endpoints bulk mark-many-read / mark-many-unread / delete-many. */
export interface BulkNotificationResult {
  affectedCount: number;
  unreadCount: number;
  asOfUtc: string;
}

/** GET /communication/notifications/unread-count */
export interface UnreadCountResult {
  count: number;
  asOfUtc: string;
}

/** POST /communication/notifications/{id}/read */
export interface MarkNotificationReadResult {
  notificationId: string;
  unreadCount: number;
  asOfUtc: string;
}

export interface MarkAllNotificationsReadResult {
  cutoffUtc: string;
  markedCount: number;
  unreadCount: number;
  asOfUtc: string;
}

export interface NotificationReadConfirmed {
  notificationId: string;
  asOfUtc: string;
}

export interface NotificationsReadAllConfirmed {
  cutoffUtc: string;
  asOfUtc: string;
}

/**
 * Mapea la `category` canónica del backend (enum del catálogo .NET, 8 valores)
 * a la categoría visual del UI. Es el camino preferido: el server ya decidió
 * qué categoría es, así que agregar un `kind` nuevo bajo una categoría existente
 * no requiere tocar el front. `typeForKind` queda como fallback para filas sin
 * categoría (notificaciones viejas pre-contrato).
 */
export function typeForCategory(
  category: string | null | undefined,
  priority: NotificationPriority,
): NotificationType | null {
  if (!category) return null;
  switch (category) {
    case 'Security':
      return 'system_alert';
    case 'Signatures':
      return 'document_signed';
    case 'DocumentsStorage':
      return 'document_uploaded';
    case 'Clients':
      return 'customer_created';
    case 'Billing':
      return priority === 'High' || priority === 'Urgent' ? 'payment_failed' : 'invoice_generated';
    case 'CalendarMeetings':
      return 'session_expiring';
    case 'Work':
    case 'Portal':
      return priority === 'High' || priority === 'Urgent' ? 'system_alert' : 'general';
    default:
      return null;
  }
}

/**
 * Mapea el `kind` del backend (evento con puntos, string libre) a la categoría
 * visual del UI (icono + color). Los kinds reales que producen los consumers:
 * signature.*, cloudstorage.*, customer.bulk_import_*, connectors.*.
 */
export function typeForKind(kind: string, priority: NotificationPriority): NotificationType {
  const k = kind.toLowerCase();
  if (k.startsWith('customer.')) {
    return k.includes('failed') ? 'system_alert' : 'customer_created';
  }
  if (k.startsWith('signature.')) {
    if (/failed|rejected|canceled/.test(k)) {
      return 'system_alert';
    }
    if (/expired|reminder_due|expiration/.test(k)) {
      return 'session_expiring';
    }
    if (/signed|completed|sealed/.test(k)) {
      return 'document_signed';
    }
    // invited, ready_for_sending, push_challenge…
    return 'document_uploaded';
  }
  if (k.startsWith('cloudstorage.')) {
    // blocked_by_policy / blocked_by_dmca_takedown / legal_hold_placed son bloqueos;
    // reinstated_from_takedown y legal_hold_lifted son buenas noticias.
    return /blocked|hold_placed/.test(k) ? 'system_alert' : 'document_uploaded';
  }
  if (k.startsWith('connectors.')) {
    return 'system_alert';
  }
  return priority === 'High' || priority === 'Urgent' ? 'system_alert' : 'general';
}

/** Icono ion por tipo — compartido por el centro de notificaciones y la campana del navbar. */
export function notificationIcon(type: NotificationType): string {
  switch (type) {
    case 'customer_created':
      return 'person-add-outline';
    case 'customer_updated':
      return 'person-outline';
    case 'customer_assigned':
      return 'people-outline';
    case 'payment_received':
      return 'cash-outline';
    case 'payment_failed':
      return 'alert-circle-outline';
    case 'invoice_generated':
      return 'receipt-outline';
    case 'document_signed':
      return 'checkmark-done-outline';
    case 'document_uploaded':
      return 'cloud-upload-outline';
    case 'session_expiring':
      return 'time-outline';
    case 'subscription_expiring':
      return 'warning-outline';
    case 'system_alert':
      return 'alert-outline';
    default:
      return 'notifications-outline';
  }
}

/**
 * Necesita atención: algo falló, caducó o está por caducar. Es el único eje por el que la
 * campana distingue una notificación de otra — y el que alimenta la pestaña "Alerts".
 */
export function needsAttention(type: NotificationType): boolean {
  return (
    type === 'system_alert' ||
    type === 'payment_failed' ||
    type === 'session_expiring' ||
    type === 'subscription_expiring'
  );
}

/**
 * Fondo del círculo del icono.
 *
 * DOS registros, no siete: neutro para todo y rojo para lo que reclama atención. Antes
 * cada tipo traía su propio color saturado, así que una lista de avisos rutinarios —"tu
 * archivo terminó de procesarse"— se veía como una fila de alarmas y el rojo dejaba de
 * significar nada. Con dos registros, el color vuelve a ser información.
 */
export function notificationIconBg(type: NotificationType): string {
  return needsAttention(type) ? 'bg-red-50' : 'bg-gray-100';
}

/** Color del glifo, en el mismo par de registros que el fondo. */
export function notificationIconText(type: NotificationType): string {
  return needsAttention(type) ? 'text-red-600' : 'text-gray-500';
}

/** DTO del backend → modelo de la lista (leída = readAtUtc !== null). */
export function dtoToAppNotification(dto: NotificationDto): AppNotification {
  // Pasamos `kind` para que i18n pueda caer en el catalogo cuando falte titleKey/bodyKey.
  const text = notificationText({ ...dto, kind: dto.kind });
  const displayAtUtc = dto.occurredAtUtc ?? dto.createdAtUtc;
  return {
    id: dto.id,
    kind: dto.kind,
    // Preferir el `category` canónico del server sobre el mapeo por `kind`:
    // el server ya decidió a qué categoría pertenece esta fila, y agregar un
    // `kind` nuevo bajo una categoría existente no requiere tocar el front.
    type: typeForCategory(dto.category, dto.priority) ?? typeForKind(dto.kind, dto.priority),
    priority: dto.priority,
    category: dto.category,
    title: text.title,
    message: text.body,
    time: notificationRelativeTime(displayAtUtc),
    createdAtUtc: dto.createdAtUtc,
    occurredAtUtc: dto.occurredAtUtc,
    createdAt: parseUtcDate(dto.createdAtUtc).getTime(),
    actorUserId: dto.actorUserId,
    actorDisplayName: dto.actorDisplayName,
    actorType: dto.actorType,
    resourceType: dto.resourceType,
    resourceId: dto.resourceId,
    resourceContext: dto.resourceContext,
    action: dto.action,
    metadata: dto.metadata,
    isRead: dto.readAtUtc !== null,
  };
}
