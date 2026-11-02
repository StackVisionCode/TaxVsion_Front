import { PublicDeliveryItem, PublicDeliveryView } from './signature-delivery.service';

export type DeliveryPageState = 'loading' | 'ready' | 'expired' | 'revoked' | 'invalid';

/** Estado de la página a partir de la respuesta del backend (404 = enlace que no existe). */
export function deliveryPageState(view: PublicDeliveryView | null): DeliveryPageState {
  if (!view) return 'invalid';
  if (view.status === 'Active') return 'ready';
  return view.status === 'Revoked' ? 'revoked' : 'expired';
}

export function deliveryItemIcon(item: PublicDeliveryItem): string {
  return item.kind === 'Certificate' ? 'ribbon-outline' : 'document-text-outline';
}

export function deliveryItemLabel(item: PublicDeliveryItem): string {
  switch (item.kind) {
    case 'Certificate':
      return 'Certificate of completion';
    case 'PartialCopy':
      return 'Signed copy (in progress)';
    default:
      return 'Signed document';
  }
}

/** Mensaje del error de reemisión que devuelve el backend, con un texto seguro por defecto. */
export function reissueErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'Signature.Delivery.ReissueTooSoon':
      return 'A new link was sent a few minutes ago. Check your inbox (and spam folder) before asking again.';
    case 'Signature.Delivery.StillActive':
      return 'This link is still valid. Reload the page to download your documents.';
    default:
      return "We couldn't send a new link. Please contact the office that sent you the documents.";
  }
}
