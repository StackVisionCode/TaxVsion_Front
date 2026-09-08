/**
 * DTOs del recorrido PÚBLICO del firmante — espejo 1:1 de
 * `TaxVision.Signature.Api/Controllers/PublicSignatureController.cs` (ruta
 * `signature/public`, `[AllowAnonymous]`).
 *
 * Notas de contrato que condicionan toda la pantalla `/sign/:token`:
 * - El token firmado (RS256) codifica `TenantId + RequestId + SignerId +
 *   RevocationEpoch + exp`; NO hay sesión, NO hay header de tenant. El backend
 *   resuelve todo desde el token (`PublicTokenResolver`).
 * - Los enums viajan como STRING (JsonStringEnumConverter), igual que el resto
 *   de servicios.
 * - Todas las mutaciones responden 204 No Content: el frontend debe re-leer el
 *   contexto (`GET /{token}`) para conocer el nuevo estado.
 *
 * Este archivo re-declara los enums en lugar de importarlos de `signature.model.ts`
 * (el modelo del staff) a propósito: la página pública es un bundle aparte que no
 * debe arrastrar el modelo/mapeos del módulo autenticado.
 */

// ---------- Enums (espejo de TaxVision.Signature.Domain.Requests) ----------

export type PublicSignatureCategory =
  | 'Fiscal'
  | 'EngagementLetter'
  | 'ConsentToDisclose'
  | 'BankAuth'
  | 'Other';

export type PublicSignatureRequestStatus =
  | 'Draft'
  | 'Ready'
  | 'InProgress'
  | 'Completed'
  | 'Rejected'
  | 'Canceled'
  | 'Expired';

export type PublicSignerStatus = 'Pending' | 'Signed' | 'Rejected' | 'Expired';

export type PublicSignatureFieldKind = 'Signature' | 'Initials' | 'Date' | 'Text' | 'Checkbox';

/**
 * Cómo se capturó la firma (`SignatureCaptureMethod`). Requisitos del handler
 * `SubmitSignatureHandler.ValidateEvidence`:
 * - `Typed`     → `typedName` obligatorio y debe COINCIDIR con el nombre completo
 *                 del firmante (comparación trim + case-insensitive).
 * - `Drawn`     → `signatureImageFileId` obligatorio (fileId de CloudStorage).
 * - `Uploaded`  → idem `Drawn`.
 */
export type SignatureCaptureMethod = 'Typed' | 'Drawn' | 'Uploaded';

/** Métodos de verificación adicional (`SignerVerificationMethod`). */
export type SignerVerificationMethod =
  | 'PractitionerPin'
  | 'SmsOtp'
  | 'EmailOtp'
  | 'WhatsAppOtp'
  | 'KbaQuiz';

/** Tipo semántico de cada fila de la cadena de audit (`SignatureAuditEventKind`). */
export type SignatureAuditEventKind =
  | 'RequestCreated'
  | 'RequestSent'
  | 'SignerViewed'
  | 'ConsentAccepted'
  | 'PinVerified'
  | 'PinFailed'
  | 'ChallengeIssued'
  | 'ChallengeVerified'
  | 'ChallengeFailed'
  | 'DocumentSigned'
  | 'SignerRejected'
  | 'RequestCanceled'
  | 'RequestExpired'
  | 'RequestCompleted'
  | 'RequestSealed'
  | 'PreparerSigned';

// ---------- GET /signature/public/{token} ----------

/**
 * Campo colocado por el preparador para ESTE firmante. Coordenadas NORMALIZADAS
 * [0..1] respecto a la página, origen arriba-izquierda; `page` es 1-based.
 */
export interface PublicSignerFieldView {
  id: string;
  kind: PublicSignatureFieldKind;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string | null;
  isRequired: boolean;
}

/**
 * Contexto completo de la firma (`PublicSignerView`). Es lo ÚNICO que el firmante
 * anónimo puede leer del documento: expone `originalFileId` pero NO `sealedFileId`
 * ni `certificateFileId` (esos viven solo en la respuesta autenticada del staff),
 * y CloudStorage exige JWT para emitir una URL presignada — de ahí que las
 * descargas queden deshabilitadas en la página pública.
 */
export interface PublicSignerView {
  signatureRequestId: string;
  signerId: string;
  title: string;
  description: string | null;
  category: PublicSignatureCategory;
  requestStatus: PublicSignatureRequestStatus;
  signerStatus: PublicSignerStatus;
  originalFileId: string;
  /** Si es true, el firmante DEBE aceptar el consent antes de poder firmar. */
  requiresConsent: boolean;
  hasAcceptedConsent: boolean;
  requiresSequentialSigning: boolean;
  /** En solicitudes secuenciales: false ⇒ todavía no es su turno (el backend rechazaría la firma). */
  isSignerNextInSequence: boolean;
  order: number;
  expiresAtUtc: string;
  signerFullName: string;
  signerEmail: string;
  /** Si es true, el firmante DEBE verificar el PIN del preparador antes de firmar. */
  requiresPractitionerPin: boolean;
  isPinVerified: boolean;
  /** Bloqueo temporal tras 5 intentos fallidos (30 min). */
  pinLockedUntilUtc: string | null;
  /**
   * OTP que el firmante debe completar antes de firmar (SMS/Email/WhatsApp). `null` = sin
   * OTP. Independiente del PIN. El backend rechaza la firma con `Signature.Request.VerificationRequired`
   * si no está completo.
   */
  requiredVerificationMethod: SignerVerificationMethod | null;
  /** true si el firmante ya completó `requiredVerificationMethod`. */
  isVerificationCompleted: boolean;
  fields: PublicSignerFieldView[];
}

// ---------- Bodies de las mutaciones ----------

export interface SubmitSignatureBody {
  method: SignatureCaptureMethod;
  typedName: string | null;
  /** Guid de CloudStorage; solo aplica a `Drawn`/`Uploaded`. */
  signatureImageFileId: string | null;
}

export interface VerifyPinBody {
  pin: string;
}

export interface IssueChallengeBody {
  method: SignerVerificationMethod;
}

export interface VerifyChallengeBody {
  method: SignerVerificationMethod;
  answer: string;
}

export interface RejectSignatureBody {
  reason: string | null;
}

// ---------- GET /signature/public/{token}/verify-audit ----------

export interface AuditChainEventView {
  sequence: number;
  kind: SignatureAuditEventKind;
  occurredAtUtc: string;
  /** JSON serializado tal cual lo firmó el backend (sin secretos). */
  payloadJson: string;
  /** HMAC encadenado de la fila — el material verificable del acuse. */
  chainHash: string;
}

export interface AuditChainDefect {
  sequence: number;
  reason: string;
}

/**
 * Veredicto de integridad de la cadena append-only. Se alimenta de eventos de
 * integración (mensajería asíncrona), así que justo después de firmar la fila
 * `DocumentSigned` puede tardar unos segundos en aparecer.
 */
export interface AuditChainVerificationResponse {
  signatureRequestId: string;
  isIntact: boolean;
  eventCount: number;
  lastSequence: number;
  defect: AuditChainDefect | null;
  events: AuditChainEventView[];
}

// ---------- Reglas de validación replicadas del dominio ----------

/** `PractitionerPin`: 4–10 dígitos, solo numéricos. */
export const PRACTITIONER_PIN_MIN_LENGTH = 4;
export const PRACTITIONER_PIN_MAX_LENGTH = 10;

export function isValidPractitionerPin(candidate: string): boolean {
  const trimmed = candidate.trim();
  return (
    trimmed.length >= PRACTITIONER_PIN_MIN_LENGTH &&
    trimmed.length <= PRACTITIONER_PIN_MAX_LENGTH &&
    /^[0-9]+$/.test(trimmed)
  );
}

/**
 * Misma comparación que `SubmitSignatureHandler.ValidateTypedName`: trim en ambos
 * lados + case-insensitive. Se replica en el cliente solo para no enviar una firma
 * que el backend va a rechazar.
 */
export function matchesSignerFullName(typedName: string, signerFullName: string): boolean {
  return typedName.trim().toLowerCase() === signerFullName.trim().toLowerCase();
}

export const SIGNATURE_CATEGORY_LABEL: Record<PublicSignatureCategory, string> = {
  Fiscal: 'Tax document',
  EngagementLetter: 'Engagement letter',
  ConsentToDisclose: 'Consent to disclose',
  BankAuth: 'Bank authorization',
  Other: 'Document',
};

export const FIELD_KIND_LABEL: Record<PublicSignatureFieldKind, string> = {
  Signature: 'Signature',
  Initials: 'Initials',
  Date: 'Date (filled automatically)',
  Text: 'Text',
  Checkbox: 'Checkbox',
};

/**
 * Traducción de cada fila de la cadena a lenguaje del firmante. El backend solo manda
 * el nombre del enum (`kind`); no hay descripción legible en el contrato, así que el
 * texto vive aquí. La lista es CERRADA en el dominio (`SignatureAuditEventKind`), y el
 * `Record` obliga a cubrir cualquier valor nuevo si algún día se amplía.
 */
export const AUDIT_EVENT_KIND_LABEL: Record<SignatureAuditEventKind, string> = {
  RequestCreated: 'Request created',
  RequestSent: 'Request sent to signers',
  SignerViewed: 'Signer opened the link',
  ConsentAccepted: 'Electronic signature consent accepted',
  PinVerified: 'Practitioner PIN verified',
  PinFailed: 'Practitioner PIN attempt failed',
  ChallengeIssued: 'Verification code sent',
  ChallengeVerified: 'Verification code confirmed',
  ChallengeFailed: 'Verification code attempt failed',
  DocumentSigned: 'Document signed',
  SignerRejected: 'Signer declined the document',
  RequestCanceled: 'Request cancelled by the office',
  RequestExpired: 'Request expired',
  RequestCompleted: 'All signers completed',
  RequestSealed: 'Final document sealed',
  PreparerSigned: 'Preparer signed',
};

/**
 * Cómo se pinta cada tipo de fila. Solo afecta al icono y al color: el veredicto de
 * integridad NO depende del tipo de evento, viene entero en `isIntact`.
 */
export const AUDIT_EVENT_KIND_ICON: Record<SignatureAuditEventKind, string> = {
  RequestCreated: 'document-text-outline',
  RequestSent: 'paper-plane-outline',
  SignerViewed: 'eye-outline',
  ConsentAccepted: 'shield-checkmark-outline',
  PinVerified: 'lock-open-outline',
  PinFailed: 'lock-closed-outline',
  ChallengeIssued: 'send-outline',
  ChallengeVerified: 'checkmark-circle-outline',
  ChallengeFailed: 'close-circle-outline',
  DocumentSigned: 'create-outline',
  SignerRejected: 'close-circle-outline',
  RequestCanceled: 'ban-outline',
  RequestExpired: 'time-outline',
  RequestCompleted: 'checkmark-done-outline',
  RequestSealed: 'ribbon-outline',
  PreparerSigned: 'person-outline',
};

/** Filas que reportan un intento fallido: se resaltan en rojo, no rompen la cadena. */
export const AUDIT_FAILURE_KINDS: ReadonlySet<SignatureAuditEventKind> = new Set<SignatureAuditEventKind>([
  'PinFailed',
  'ChallengeFailed',
  'SignerRejected',
  'RequestCanceled',
  'RequestExpired',
]);

// ---------- Errores del contrato público ----------

/**
 * Códigos que invalidan el enlace por completo (no hay reintento útil): el
 * `PublicTokenResolver` los devuelve antes de tocar el aggregate.
 */
const DEAD_LINK_CODES = new Set([
  'Signature.Token.Format',
  'Signature.Token.Signature',
  'Signature.Token.Payload',
  'Signature.Token.Expired',
  'Signature.Token.Revoked',
  'Signature.Request.NotFound',
  'Signature.Signer.NotFound',
  // El Gateway/Signature host-guard rechaza abrir la firma bajo el subdominio de otra oficina
  // (403 { error: "tenant_host_mismatch" }). Es terminal: no hay reintento útil bajo este host.
  'tenant_host_mismatch',
]);

export function isDeadLinkCode(code: string): boolean {
  return DEAD_LINK_CODES.has(code);
}

/** Título + explicación en la voz del firmante para cada código de enlace muerto. */
export function describeDeadLink(code: string): { title: string; detail: string } {
  switch (code) {
    case 'Signature.Token.Expired':
      return {
        title: 'This link has expired',
        detail: 'Signature links are valid for a limited time. Ask the office to send you a new one.',
      };
    case 'Signature.Token.Revoked':
      return {
        title: 'This link is no longer active',
        detail:
          'The office cancelled the request, or the document was already declined. Ask them for a new link.',
      };
    case 'Signature.Request.NotFound':
    case 'Signature.Signer.NotFound':
      return {
        title: 'We could not find this document',
        detail: 'The request may have been removed. Please contact the office that sent it to you.',
      };
    case 'tenant_host_mismatch':
      return {
        title: 'This link opened at the wrong address',
        detail: 'This signature request belongs to a different office. Please open the link exactly as it appears in the email we sent you.',
      };
    default:
      return {
        title: 'This link is not valid',
        detail: 'Make sure you opened the full link from your email, or ask the office to resend it.',
      };
  }
}
