/** Estado de la revisión del PDF original en el servidor, tal como llega en cada documento de la solicitud. */
export interface VerifiableDocument {
  title: string;
  hashPre: string | null;
  hashPost: string | null;
  verificationStatus?: 'Pending' | 'Verified' | 'Rejected';
  rejectionReason?: string | null;
}

const FALLBACK_REASON = 'the file is not a valid PDF.';

/** Línea de estado del documento en el detalle de la solicitud. */
export function documentVerificationLabel(document: VerifiableDocument): string {
  if (document.hashPost) return 'Sealed and verified';
  if (document.verificationStatus === 'Rejected') {
    return `Rejected: ${document.rejectionReason ?? FALLBACK_REASON} Replace the file.`;
  }
  if (document.hashPre) return 'Original verified';
  return 'Verification pending';
}

/** Primer documento rechazado por el servidor, con el mensaje para el usuario; null si no hay ninguno. */
export function rejectedDocumentMessage(documents: readonly VerifiableDocument[]): string | null {
  const rejected = documents.find((document) => document.verificationStatus === 'Rejected');
  return rejected
    ? `"${rejected.title}" can't be sent: ${rejected.rejectionReason ?? FALLBACK_REASON} Replace the file and try again.`
    : null;
}
