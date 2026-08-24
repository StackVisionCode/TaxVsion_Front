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
