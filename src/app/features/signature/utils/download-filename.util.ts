/**
 * Nombre de archivo profesional para las descargas de una solicitud de firma (12.3/12.4), derivado
 * del título: "2026 Individual Tax Return" → `2026_Individual_Tax_Return_Signed.pdf` /
 * `2026_Individual_Tax_Return_Certificate.pdf`. Sin acentos ni caracteres reservados de los sistemas
 * de archivos, con longitud acotada; si el título no deja nada útil se usa un nombre genérico.
 */
export type SignatureDownloadKind = 'signed' | 'certificate' | 'original';

const SUFFIX: Record<SignatureDownloadKind, string> = {
  signed: 'Signed',
  certificate: 'Certificate',
  original: 'Original',
};

const FALLBACK_BASE = 'Signature_Request';
/** Tope del tramo del título (sin sufijo ni extensión), holgado para cualquier sistema de archivos. */
const MAX_BASE_LENGTH = 80;

/** Deja solo [A-Za-z0-9] separados por `_` (sin acentos, sin `_` repetidos ni en los bordes). */
export function sanitizeFileBase(title: string | null | undefined): string {
  const cleaned = (title ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita diacríticos (é → e)
    .replace(/\.pdf$/i, '') // un título copiado del nombre del archivo no duplica la extensión
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const capped = cleaned.slice(0, MAX_BASE_LENGTH).replace(/_+$/g, '');
  return capped || FALLBACK_BASE;
}

export function buildSignatureDownloadFilename(title: string | null | undefined, kind: SignatureDownloadKind): string {
  return `${sanitizeFileBase(title)}_${SUFFIX[kind]}.pdf`;
}
