import { FieldType, WizardClient } from '../ui/signature-request-panel/signature-wizard.model';
import { Signer, SignatureRequest, SignatureStatus, SignerStatus } from '../ui/signature-table/signature-table.component';

/**
 * DTOs del servicio Signature (TaxVision.Signature.Api vía Gateway, base `/signature`).
 * Espejo 1:1 de los records del backend — JSON camelCase y enums serializados como
 * STRINGS (JsonStringEnumConverter), igual que el resto de servicios.
 */

// ---------- Enums (espejo de TaxVision.Signature.Domain.Requests) ----------

export type SignatureCategory = 'Fiscal' | 'EngagementLetter' | 'ConsentToDisclose' | 'BankAuth' | 'Other';

export type ApiSignatureRequestStatus =
  | 'Draft'
  | 'Ready'
  | 'InProgress'
  | 'Completed'
  | 'Rejected'
  | 'Canceled'
  | 'Expired';

export type ApiSignerStatus = 'Pending' | 'Signed' | 'Rejected' | 'Expired';

export type SignatureFieldKind = 'Signature' | 'Initials' | 'Date' | 'Text' | 'Checkbox';

export const SIGNATURE_CATEGORIES: SignatureCategory[] = [
  'Fiscal',
  'EngagementLetter',
  'ConsentToDisclose',
  'BankAuth',
  'Other',
];

export const SIGNATURE_CATEGORY_LABEL: Record<SignatureCategory, string> = {
  Fiscal: 'Fiscal',
  EngagementLetter: 'Engagement letter',
  ConsentToDisclose: 'Consent to disclose',
  BankAuth: 'Bank authorization',
  Other: 'Other',
};

/** Rango permitido por el dominio (SignatureRequest.ValidateFactoryInputs / ExtendExpiration). */
export const TOKEN_EXPIRATION_MIN_HOURS = 1;
export const TOKEN_EXPIRATION_MAX_HOURS = 720;
/** Default cuando el usuario no elige fecha límite: 7 días. */
export const TOKEN_EXPIRATION_DEFAULT_HOURS = 168;

// ---------- Respuestas ----------

/** Campo colocado. Coordenadas NORMALIZADAS [0..1] respecto a la página, origen ARRIBA-IZQUIERDA (FieldPosition). */
export interface SignatureFieldResponse {
  id: string;
  signerId: string;
  kind: SignatureFieldKind;
  /** 1-based. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string | null;
  isRequired: boolean;
}

export interface SignerResponse {
  id: string;
  email: string;
  fullName: string;
  mappedCustomerId: string | null;
  order: number;
  status: ApiSignerStatus;
  signedAtUtc: string | null;
  fields: SignatureFieldResponse[];
}

/** GET /signature/requests/{id} y respuesta de POST /signature/requests. */
export interface SignatureRequestDetail {
  id: string;
  tenantId: string;
  createdByUserId: string;
  title: string;
  description: string | null;
  category: SignatureCategory;
  status: ApiSignatureRequestStatus;
  originalFileId: string;
  documentHashPre: string | null;
  sealedFileId: string | null;
  documentHashPost: string | null;
  certificateFileId: string | null;
  requiresSequentialSigning: boolean;
  requiresConsent: boolean;
  generateCertificate: boolean;
  requiresPractitionerPin: boolean;
  practitionerPinSetAtUtc: string | null;
  tokenExpirationHours: number;
  expiresAtUtc: string;
  revocationEpoch: number;
  createdAtUtc: string;
  updatedAtUtc: string;
  sentAtUtc: string | null;
  completedAtUtc: string | null;
  canceledAtUtc: string | null;
  expiredAtUtc: string | null;
  signers: SignerResponse[];
}

/** Fila de GET /signature/requests (listado paginado). */
export interface SignatureRequestSummary {
  id: string;
  title: string;
  category: SignatureCategory;
  status: ApiSignatureRequestStatus;
  originalFileId: string;
  signerCount: number;
  expiresAtUtc: string;
  createdAtUtc: string;
  sentAtUtc: string | null;
  completedAtUtc: string | null;
}

export interface SignatureRequestListResult {
  items: SignatureRequestSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/** POST /signature/documents/validate. */
export interface DocumentValidationIssue {
  code: string;
  message: string;
}

export interface ValidateDocumentResponse {
  isAcceptable: boolean;
  issues: DocumentValidationIssue[];
  contentSha256: string;
  sizeBytes: number;
  pageCount: number | null;
  hasExistingSignatures: boolean;
  validationRecordId: string;
}

/** GET /signature/analytics/summary. */
export interface SignatureAnalyticsSummary {
  tenantId: string;
  fromDay: string;
  toDay: string;
  requestsCreated: number;
  requestsSent: number;
  requestsCanceled: number;
  requestsExpired: number;
  requestsCompleted: number;
  requestsSealed: number;
  signersSigned: number;
  signersRejected: number;
  completionRate: number;
  rejectionRate: number;
}

// ---------- Plantillas de firma ----------

/** Draft = aún se edita; Published = usable; Archived = fuera de circulación. */
export type SignatureTemplateStatus = 'Draft' | 'Published' | 'Archived';

/** Fila de GET /signature/templates. */
export interface TemplateSummary {
  id: string;
  title: string;
  category: SignatureCategory;
  status: SignatureTemplateStatus;
  /** Cuántos firmantes por rol define el molde: hay que atar uno concreto a cada uno. */
  slotCount: number;
  fieldCount: number;
  createdAtUtc: string;
  publishedAtUtc: string | null;
}

export interface TemplateListResult {
  items: TemplateSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/** Rol de firmante del molde (p. ej. "Client", "Spouse", "Preparer"). */
export interface TemplateSlotResponse {
  id: string;
  order: number;
  role: string;
  defaultLanguage: string;
}

export interface TemplateFieldResponse {
  id: string;
  slotOrder: number;
  kind: SignatureFieldKind;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string | null;
  isRequired: boolean;
}

/** GET /signature/templates/{id} — el molde completo, con sus slots y campos. */
export interface SignatureTemplateDetail {
  id: string;
  title: string;
  description: string | null;
  category: SignatureCategory;
  status: SignatureTemplateStatus;
  defaultTokenExpirationHours: number;
  requiresSequentialSigning: boolean;
  requiresConsent: boolean;
  generateCertificate: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
  publishedAtUtc: string | null;
  slots: TemplateSlotResponse[];
  fields: TemplateFieldResponse[];
}

/** Ata un firmante real a un rol del molde. */
export interface SlotBinding {
  slotOrder: number;
  email: string;
  fullName: string;
}

/**
 * POST /signature/templates/{id}/instantiate.
 * El PDF ya tiene que estar subido a CloudStorage: la plantilla aporta el
 * layout de campos y los settings, no el documento.
 */
export interface InstantiateTemplateBody {
  originalFileId: string;
  slotBindings: SlotBinding[];
  descriptionOverride: string | null;
}

// ---------- Cuerpos de request ----------

/**
 * PUT /signature/requests/{id}/preparer — identidad del preparador (Form 8879 §V).
 * Espejo de `SetPreparerBody(string PtinOrEfin, string DisplayName, string? TitleLabel)`.
 */
export interface SetPreparerBody {
  ptinOrEfin: string;
  displayName: string;
  titleLabel: string | null;
}

export interface CreateSignatureRequestBody {
  title: string;
  description?: string | null;
  category: SignatureCategory;
  originalFileId: string;
  tokenExpirationHours: number;
  requiresSequentialSigning: boolean;
  requiresConsent: boolean;
  generateCertificate: boolean;
}

export interface AddSignerBody {
  email: string;
  fullName: string;
}

/** Coordenadas normalizadas [0..1], origen arriba-izquierda; page 1-based (FieldPosition del dominio). */
export interface PlaceFieldBody {
  signerId: string;
  kind: SignatureFieldKind;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string | null;
  isRequired: boolean;
}

export interface ListSignatureRequestsParams {
  status?: ApiSignatureRequestStatus;
  category?: SignatureCategory;
  page?: number;
  size?: number;
}

// ---------- Customers (subset espejo de Customer.Api; sin import cruzado de features) ----------

export interface SignatureCustomerSummary {
  id: string;
  kind: 'Individual' | 'Business';
  status: 'Active' | 'Inactive' | 'Archived';
  displayName: string;
  primaryEmail: string;
  primaryPhone: string | null;
  createdAtUtc: string;
}

export interface SignatureCustomersPage {
  items: SignatureCustomerSummary[];
  totalCount: number;
}

// ---------- Adaptadores backend -> shapes de UI existentes ----------

const SIGNER_AVATAR_COLORS = ['bg-brand-bold', 'bg-sky-700', 'bg-brand-ink', 'bg-slate-500', 'bg-indigo-400'];

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map(part => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function apiStatusToUi(status: ApiSignatureRequestStatus): SignatureStatus {
  switch (status) {
    case 'Draft':
      return 'draft';
    case 'Ready':
      return 'ready';
    case 'InProgress':
      return 'in-progress';
    case 'Completed':
      return 'completed';
    case 'Rejected':
      return 'rejected';
    case 'Canceled':
      return 'canceled';
    case 'Expired':
      return 'expired';
  }
}

export function apiSignerStatusToUi(status: ApiSignerStatus): SignerStatus {
  switch (status) {
    case 'Pending':
      return 'pending';
    case 'Signed':
      return 'signed';
    case 'Rejected':
      return 'rejected';
    case 'Expired':
      return 'expired';
  }
}

function signerToUi(signer: SignerResponse, index: number): Signer {
  return {
    id: signer.id,
    name: signer.fullName,
    initials: initialsOf(signer.fullName),
    email: signer.email,
    color: SIGNER_AVATAR_COLORS[index % SIGNER_AVATAR_COLORS.length],
    status: apiSignerStatusToUi(signer.status),
    signedAt: signer.signedAtUtc ? signer.signedAtUtc.slice(0, 10) : null,
  };
}

/** Detalle del backend -> fila/preview de la tabla existente. El "client" se deriva del primer firmante (orden 1). */
export function detailToUiRequest(detail: SignatureRequestDetail): SignatureRequest {
  const ordered = [...detail.signers].sort((a, b) => a.order - b.order);
  return {
    id: detail.id,
    documentName: detail.title,
    client: ordered[0]?.fullName ?? '—',
    signers: ordered.map(signerToUi),
    status: apiStatusToUi(detail.status),
    sentDate: detail.sentAtUtc ? detail.sentAtUtc.slice(0, 10) : null,
    dueDate: detail.expiresAtUtc.slice(0, 10),
    completedDate: detail.completedAtUtc ? detail.completedAtUtc.slice(0, 10) : null,
    notes: detail.description ?? '',
    category: detail.category,
    originalFileId: detail.originalFileId,
    sealedFileId: detail.sealedFileId,
    certificateFileId: detail.certificateFileId,
    requiresPractitionerPin: detail.requiresPractitionerPin,
    practitionerPinSetAtUtc: detail.practitionerPinSetAtUtc,
  };
}

/** Fila de GET /customers -> shape que ya consumen los pasos del wizard. */
export function customerToWizardClient(summary: SignatureCustomerSummary): WizardClient {
  return {
    id: summary.id,
    displayName: summary.displayName,
    email: summary.primaryEmail,
    phone: summary.primaryPhone ?? '',
    type: summary.kind === 'Business' ? 'company' : 'individual',
    isActive: summary.status === 'Active',
    createdAt: summary.createdAtUtc.slice(0, 10),
  };
}

/** Tipo de campo del editor -> enum del backend. */
export function fieldTypeToKind(type: FieldType): SignatureFieldKind {
  switch (type) {
    case 'signature':
      return 'Signature';
    case 'initials':
      return 'Initials';
    case 'date':
      return 'Date';
    case 'text':
      return 'Text';
  }
}
