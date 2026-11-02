import { SignedDocumentDelivery } from '../data-access/signature.model';

/** Línea de estado de una entrega en el detalle de la solicitud. */
export function deliveryStatusLabel(delivery: SignedDocumentDelivery): string {
  switch (delivery.status) {
    case 'Revoked':
      return 'Link turned off';
    case 'Expired':
      return 'Link expired';
    default:
      return delivery.accessCount > 0
        ? `Opened ${delivery.accessCount} ${delivery.accessCount === 1 ? 'time' : 'times'}`
        : 'Not opened yet';
  }
}

export function deliveryPurposeLabel(delivery: SignedDocumentDelivery): string {
  return delivery.purpose === 'PartialCopy' ? 'In-progress copy' : 'Signed documents';
}

/** Reenviar vale salvo revocada; revocar solo mientras el enlace sigue vigente. */
export function canResendDelivery(delivery: SignedDocumentDelivery): boolean {
  return delivery.status !== 'Revoked';
}

export function canRevokeDelivery(delivery: SignedDocumentDelivery): boolean {
  return delivery.status === 'Active';
}
