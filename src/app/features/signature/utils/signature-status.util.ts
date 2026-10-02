import { StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { SignatureStatus } from '../ui/signature-table/signature-table.component';

/** Etiqueta visible de cada estado de solicitud (tabla y vista previa). */
export const SIGNATURE_STATUS_LABEL: Record<SignatureStatus, string> = {
  draft: 'Draft',
  ready: 'Ready',
  pending: 'Pending',
  'in-progress': 'In Progress',
  completed: 'Completed',
  rejected: 'Rejected',
  canceled: 'Canceled',
  expired: 'Expired',
};

export interface SignatureStatusPill {
  tone: StatusTone;
  /** Solo para colores fuera de la paleta de `app-status-pill` (expired = ámbar). */
  toneClass?: string;
  dotClass?: string;
}

/** Estado → tono de `app-status-pill` (mismos colores que los mapas statusChip/statusDot de antes). */
export const SIGNATURE_STATUS_PILL: Record<SignatureStatus, SignatureStatusPill> = {
  draft: { tone: 'neutral' },
  ready: { tone: 'info' },
  pending: { tone: 'warning' },
  'in-progress': { tone: 'brand' },
  completed: { tone: 'success' },
  rejected: { tone: 'danger' },
  canceled: { tone: 'neutral' },
  expired: { tone: 'neutral', toneClass: 'border-amber-200 text-amber-600', dotClass: 'bg-amber-500' },
};
