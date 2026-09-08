import {
  AppNotification,
  NotificationType,
} from '../ui/notification-list/notification-list.component';

/**
 * Contratos del backend de notificaciones (Communication, Fastify/TS vía
 * Gateway — ver notifications.route.ts + notification-queries.ts en
 * Services/Communication). Endpoints HTTP reales:
 *
 * - GET  /communication/notifications?page&size[&unreadOnly] → NotificationListResult
 * - GET  /communication/notifications/unread-count           → { count }
 * - POST /communication/notifications/{id}/read              → { notificationId, unreadCount }
 *
 * NO existen por HTTP: delete/dismiss (dismiss es Socket.IO-only:
 * `notification.dismiss`), mark-as-unread (no existe en el backend) ni un
 * bulk "mark all read".
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
  /** ISO 8601 UTC. */
  createdAtUtc: string;
  /** ISO 8601 UTC o null si no está leída. */
  readAtUtc: string | null;
}

/** Envelope de GET /communication/notifications (sin total global — solo la página). */
export interface NotificationListResult {
  items: NotificationDto[];
  page: number;
  size: number;
  /** Conteo de no-leídas del usuario en TODO el tenant (no solo esta página). */
  unreadCount: number;
}

/** GET /communication/notifications/unread-count */
export interface UnreadCountResult {
  count: number;
}

/** POST /communication/notifications/{id}/read */
export interface MarkNotificationReadResult {
  notificationId: string;
  unreadCount: number;
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

/** "Just now" / "20m ago" / "3h ago" / "Yesterday" / "3 days ago" / fecha. */
export function relativeTimeLabel(isoUtc: string, nowMs: number = Date.now()): string {
  const then = new Date(isoUtc).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const minutes = Math.floor(Math.max(0, nowMs - then) / 60_000);
  if (minutes < 1) {
    return 'Just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  return new Date(then).toLocaleDateString();
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
  return {
    id: dto.id,
    type: typeForKind(dto.kind, dto.priority),
    title: dto.title,
    message: dto.body,
    time: relativeTimeLabel(dto.createdAtUtc),
    createdAt: new Date(dto.createdAtUtc).getTime(),
    isRead: dto.readAtUtc !== null,
  };
}
