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

export type EmailActivityFilter = 'All' | 'Delivered' | 'Sent' | 'Bounced' | 'Failed' | 'Complained';

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

export const EMAIL_ACTIVITY_FILTERS: readonly SegmentedOption<EmailActivityFilter>[] = [
  { id: 'All', label: 'All' },
  { id: 'Delivered', label: 'Delivered' },
  { id: 'Sent', label: 'Pending' },
  { id: 'Bounced', label: 'Bounced' },
  { id: 'Failed', label: 'Failed' },
  { id: 'Complained', label: 'Spam' },
];

/** Aperturas y clics son aproximados: algunos clientes de correo abren los mensajes solos. */
export const ENGAGEMENT_HINT = 'Approximate — some email apps open messages automatically';

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
