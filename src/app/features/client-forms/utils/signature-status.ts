import type { StatusTone } from '@shared/ui/status-pill/status-pill.component';
import type { FormSignatureStatus } from '../data-access/client-forms.model';

// P-18 — etiqueta y tono visibles de la firma opcional (drawer de revisión y bandeja).
// `None` (y ausencia del campo) no se muestra.
const SIGNATURE_STATUS_LABEL: Record<Exclude<FormSignatureStatus, 'None'>, string> = {
  Requesting: 'Requesting signature…',
  Sent: 'Awaiting signature',
  Signed: 'Signed by participant',
  Completed: 'Signed',
  Sealed: 'Signed & sealed',
  Declined: 'Signature declined',
  Canceled: 'Signature canceled',
  Expired: 'Signature expired',
  Failed: 'Signature failed',
};

const SIGNATURE_STATUS_TONE: Record<Exclude<FormSignatureStatus, 'None'>, StatusTone> = {
  Requesting: 'info',
  Sent: 'warning',
  Signed: 'brand',
  Completed: 'success',
  Sealed: 'success',
  Declined: 'danger',
  Canceled: 'muted',
  Expired: 'neutral',
  Failed: 'danger',
};

/** Etiqueta visible, o `null` cuando no hay firma que mostrar (`None` o ausente). */
export function signatureStatusLabel(status: FormSignatureStatus | null | undefined): string | null {
  return status && status !== 'None' ? SIGNATURE_STATUS_LABEL[status] : null;
}

/** Tono de `app-status-pill`; `neutral` por defecto. */
export function signatureStatusTone(status: FormSignatureStatus | null | undefined): StatusTone {
  return status && status !== 'None' ? SIGNATURE_STATUS_TONE[status] : 'neutral';
}
