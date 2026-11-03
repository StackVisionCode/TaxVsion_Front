import { StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { SegmentedOption } from '@shared/ui/segmented/segmented.component';

/**
 * "Email activity" — qué pasó con cada correo que salió de la oficina (Postmaster).
 * El estado une el resultado del envío con lo que contó el proveedor después.
 */
export type EmailActivityStatus =
  | 'Sending'
  | 'Sent'
  | 'Deferred'
  | 'Delivered'
  | 'Bounced'
  | 'Complained'
  | 'Failed'
  | 'Suppressed';

/** Por dónde salió: el proveedor del sistema o el buzón conectado de la oficina. */
export type EmailLane = 'SystemProvider' | 'TenantMailbox';

/** Mismos valores que el estado de cada fila: una pestaña muestra solo filas con esa píldora. */
export type EmailActivityFilter =
  | 'All'
  | 'Delivered'
  | 'Sent'
  | 'Deferred'
  | 'Bounced'
  | 'Failed'
  | 'Suppressed'
  | 'Complained';

/** `?engagement=`: algún destinatario abrió / hizo clic. Se combina con el estado y el destinatario. */
export type EmailEngagementFilter = 'Opened' | 'Clicked';

export interface EmailActivityItem {
  id: string;
  subject: string;
  /** Enmascaradas (j***@dominio) para quien no es admin. */
  recipients: string[];
  lane: EmailLane;
  status: EmailActivityStatus;
  queuedAtUtc: string;
  sentAtUtc: string | null;
  lastEventAtUtc: string | null;
  opened: boolean;
  clicked: boolean;
}

/** `GET /postmaster/messages` devuelve `{ items, page, size, totalCount }`. */
export interface EmailActivityPage {
  items: EmailActivityItem[];
  page: number;
  size: number;
  totalCount: number;
}

export interface EmailActivityRecipient {
  id: string;
  address: string;
  type: 'To' | 'Cc' | 'Bcc';
  outcome: string | null;
  outcomeAtUtc: string | null;
  errorReason: string | null;
  openCount: number;
  firstOpenedAtUtc: string | null;
  clickCount: number;
  firstClickedAtUtc: string | null;
  unsubscribedAtUtc: string | null;
}

export interface EmailActivityTimelineEntry {
  eventType: string;
  eventAtUtc: string;
  recipient: string | null;
  reason: string | null;
}

export interface EmailActivityDetail {
  id: string;
  subject: string;
  fromAddress: string;
  lane: EmailLane;
  status: EmailActivityStatus;
  queuedAtUtc: string;
  sentAtUtc: string | null;
  errorReason: string | null;
  recipients: EmailActivityRecipient[];
  timeline: EmailActivityTimelineEntry[];
}

// La etiqueta de cada pestaña es la misma que la píldora de sus filas (antes "Pending" filtraba "Sent").
export const EMAIL_ACTIVITY_FILTERS: readonly SegmentedOption<EmailActivityFilter>[] = [
  { id: 'All', label: 'All' },
  { id: 'Delivered', label: statusLabel('Delivered') },
  { id: 'Sent', label: statusLabel('Sent') },
  { id: 'Deferred', label: statusLabel('Deferred') },
  { id: 'Bounced', label: statusLabel('Bounced') },
  { id: 'Failed', label: statusLabel('Failed') },
  { id: 'Suppressed', label: statusLabel('Suppressed') },
  { id: 'Complained', label: 'Spam' },
];

/** "Sent" no es "pendiente": algunos proveedores (p. ej. el buzón conectado) solo avisan si hay un problema. */
export const SENT_STATUS_HINT =
  'Sent means the mail server accepted the email. Some providers only report problems, so a sent email may never change to Delivered.';

/** Aperturas y clics son aproximados: algunos clientes de correo abren los mensajes solos. */
export const ENGAGEMENT_HINT = 'Approximate — some email apps open messages automatically';

/** Filtros de interacción de la barra: se activan/desactivan solos, aparte de las pestañas de estado. */
export const EMAIL_ENGAGEMENT_FILTERS: readonly SegmentedOption<EmailEngagementFilter>[] = [
  { id: 'Opened', label: 'Opened', icon: 'eye-outline' },
  { id: 'Clicked', label: 'Clicked', icon: 'link-outline' },
];

/** Ícono junto al estado de una fila; `hint` sirve de tooltip y de nombre accesible. */
export interface EngagementBadge {
  kind: EmailEngagementFilter;
  icon: string;
  hint: string;
}

export function engagementBadges(
  item: Pick<EmailActivityItem, 'opened' | 'clicked'>,
): EngagementBadge[] {
  return EMAIL_ENGAGEMENT_FILTERS.filter(option =>
    option.id === 'Opened' ? item.opened : item.clicked,
  ).map(option => ({
    kind: option.id,
    icon: option.icon ?? '',
    hint: `${option.label}. ${ENGAGEMENT_HINT}`,
  }));
}

export function statusTone(status: EmailActivityStatus | string): StatusTone {
  switch (status) {
    case 'Delivered':
      return 'success';
    case 'Bounced':
    case 'Complained':
    case 'Failed':
    case 'HardBounced':
    case 'SoftBounced':
    case 'Rejected':
      return 'danger';
    case 'Deferred':
    case 'Suppressed':
      return 'warning';
    case 'Sent':
    case 'Accepted':
    case 'Sending':
      return 'info';
    default:
      return 'neutral';
  }
}

export function statusLabel(status: EmailActivityStatus | string): string {
  switch (status) {
    case 'Sent':
    case 'Accepted':
      return 'Sent';
    case 'Deferred':
      return 'Delayed';
    case 'Suppressed':
      return 'Blocked';
    case 'Complained':
      return 'Marked as spam';
    case 'HardBounced':
      return 'Bounced';
    case 'SoftBounced':
      return 'Bounced (temporary)';
    default:
      return status;
  }
}

/** Qué significa cada estado, en una frase (tooltip de la píldora). */
export function statusHint(status: EmailActivityStatus | string): string {
  switch (status) {
    case 'Sending':
      return 'The email is on its way to the mail server.';
    case 'Sent':
    case 'Accepted':
      return 'Accepted by the mail server. No delivery confirmation yet.';
    case 'Deferred':
      return "The recipient's server asked to try again later. It will keep retrying.";
    case 'Delivered':
      return "The recipient's server confirmed delivery.";
    case 'Bounced':
    case 'HardBounced':
    case 'SoftBounced':
    case 'Rejected':
      return "The email couldn't be delivered. Open it to see why.";
    case 'Complained':
      return 'The recipient marked the email as spam.';
    case 'Failed':
      return 'The email could not be sent.';
    case 'Suppressed':
      return 'Not sent: this address is blocked after a bounce or a spam report.';
    default:
      return '';
  }
}

export function laneLabel(lane: EmailLane): string {
  return lane === 'TenantMailbox' ? 'Office mailbox' : 'System';
}

/** Nombre legible de cada evento de la línea de tiempo. */
export function timelineLabel(eventType: string): string {
  switch (eventType) {
    case 'Queued':
      return 'Queued';
    case 'Sent':
      return 'Accepted by the mail server';
    case 'Delivered':
      return 'Delivered';
    case 'Deferred':
      return 'Delivery delayed';
    case 'Bounced':
      return 'Bounced';
    case 'Rejected':
      return 'Rejected';
    case 'Complained':
      return 'Marked as spam';
    case 'Opened':
      return 'Opened';
    case 'Clicked':
      return 'Link clicked';
    case 'Unsubscribed':
      return 'Unsubscribed';
    case 'Suppressed':
      return 'Not sent — address suppressed';
    case 'Failed':
      return 'Failed';
    default:
      return eventType;
  }
}
