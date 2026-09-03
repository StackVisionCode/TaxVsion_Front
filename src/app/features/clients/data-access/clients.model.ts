import { ClientItem } from '../ui/client-table/client-table.component';
import type { ClientProfile } from '../models/client-profile.model';

/** Espejo de TaxVision.Customer.Domain.Customers.CustomerKind. */
export type CustomerKind = 'Individual' | 'Business';

/** Espejo de TaxVision.Customer.Domain.Customers.CustomerStatus. */
export type CustomerStatus = 'Active' | 'Inactive' | 'Archived';

/** Espejo de TaxVision.Customer.Application.Customers.CustomerStatusFilter (query param `status` de GET /customers). */
export type CustomerStatusFilter = 'Active' | 'Inactive' | 'Archived' | 'NotArchived' | 'All';

/** Espejo de TaxVision.Customer.Domain.Customers.Language. */
export type CustomerLanguage = 'Es' | 'En' | 'Pt' | 'Fr';

/** Espejo de TaxVision.Customer.Domain.Customers.PreferredChannel. */
export type PreferredChannel = 'Email' | 'Sms' | 'Call';

/** Espejo de TaxVision.Customer.Domain.Customers.BusinessStructure. */
export type ApiBusinessStructure =
  | 'SoleProprietorship'
  | 'Partnership'
  | 'Llc'
  | 'SCorp'
  | 'CCorp'
  | 'NonProfit'
  | 'Other';

/** Acciones de POST /customers/{id}/{action}. */
export type CustomerStatusAction = 'archive' | 'reactivate' | 'activate' | 'deactivate';

/** Espejo de TaxVision.Customer.Domain.FiscalProfiles.FiscalSubjectKind. */
export type FiscalSubjectKind = 'Individual' | 'Business';

/** Espejo de TaxVision.Customer.Domain.Addresses.AddressKind. Sí, `HomeOoffice` es un typo real del backend. */
export type AddressKind =
  | 'Home'
  | 'Mailing'
  | 'Business'
  | 'Previous'
  | 'Foreign'
  | 'Billing'
  | 'Shipping'
  | 'Seasonal'
  | 'Legal'
  | 'HomeOoffice';

/** Espejo de TaxVision.Customer.Domain.ContactPoints.ContactPointType. */
export type ContactPointType = 'Email' | 'Phone';

/** Espejo de TaxVision.Customer.Domain.Relations.RelationshipKind (catálogo no cerrado en la guía — tipado como string abierto). */
export type RelationshipKind = string;

/**
 * Espejo de TaxVision.Customer.Domain.Relations.RelationPurpose — [Flags] int,
 * sumar valores para combinar (p.ej. Dependent + TaxHouseholdMember = 3).
 */
export const RelationPurpose = {
  None: 0,
  Dependent: 1,
  TaxHouseholdMember: 2,
  EmergencyContact: 4,
  AuthorizedRepresentative: 8,
  BusinessContact: 16,
  BeneficialOwner: 32,
} as const;

/** Fila de GET /customers (lista paginada). Sin address/ssn/ein — el backend no los expone en el listado. */
export interface CustomerSummary {
  id: string;
  kind: CustomerKind;
  status: CustomerStatus;
  displayName: string;
  primaryEmail: string;
  primaryPhone: string | null;
  createdAtUtc: string;
}

/** GET /customers/{id} y respuesta de POST/PATCH /customers. */
export interface Customer {
  id: string;
  tenantId: string;
  kind: CustomerKind;
  status: CustomerStatus;
  displayName: string;
  primaryEmail: string;
  primaryPhone: string | null;
  language: CustomerLanguage;
  preferredChannel: PreferredChannel;
  occupationId: string | null;
  occupationName: string | null;
  principalBusinessActivityId: string | null;
  principalBusinessActivityName: string | null;
  /** Fecha de nacimiento (individuo), `yyyy-MM-dd`. Ahora sí viene en el detalle (antes write-only). */
  dateOfBirth?: string | null;
  /** Partes del nombre — ahora en el detalle para que el form de edición prefille sin partir el displayName. */
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  legalName?: string | null;
  createdAtUtc: string;
  assignedPreparerUserId: string | null;
}

export interface AddressResponse {
  id: string;
  kind: AddressKind;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode: string;
  countryCode: string;
  isPrimary: boolean;
}

export interface ContactPointResponse {
  id: string;
  type: ContactPointType;
  value: string;
  label?: string | null;
  isPrimary: boolean;
  verifiedAtUtc?: string | null;
}

export interface RelationResponse {
  id: string;
  relationshipKind: RelationshipKind;
  /** Bitmask — comparar con `& RelationPurpose.Xxx`. */
  purposes: number;
  displayName: string;
  primaryEmail?: string | null;
  primaryPhone?: string | null;
  /** yyyy-MM-dd (DateOnly). */
  dateOfBirth?: string | null;
  isActive: boolean;
}

/** SIEMPRE enmascarado (`taxIdentifierLast4`) — el completo solo sale por GET /{id}/fiscal-profile/tax-identifier (reveal auditado). */
export interface CustomerFiscalProfileResponse {
  customerId: string;
  subjectKind: FiscalSubjectKind;
  taxIdentifierLast4: string | null;
  filingStatus?: string | null;
  priorYearAgi?: number | null;
  isReturningCustomer: boolean;
  hasRefundBankInfo: boolean;
  updatedAtUtc: string;
  updatedByUserId: string;
}

export interface RevealedTaxIdentifierResponse {
  customerId: string;
  subjectKind: FiscalSubjectKind;
  /** "123-45-6789" | "12-3456789", en claro. */
  taxIdentifier: string;
}

/**
 * GET /customers/{id}.
 *
 * ✅ Verificado contra el backend (2026-09-03, `CustomerReadService.GetDetailByIdAsync`):
 * este endpoint SÍ puebla `addresses`, `contactPoints`, `relations` y `fiscalProfile`
 * (los proyecta desde `CustomerAddresses`/`ContactPoints`/`Relations`/`FiscalProfiles`).
 * El detalle es el único punto de lectura de estas colecciones — no hay GET por
 * sub-colección (solo POST/PATCH/DELETE), salvo el reveal auditado del tax id.
 *
 * Se dejan **opcionales por defensa** (y los adaptadores usan `?? []`): así un
 * cliente sin direcciones/relaciones no rompe la ficha, y el tipo tolera un
 * backend más viejo. El fiscalProfile va siempre enmascarado (last4).
 */
export interface CustomerDetailResponse extends Customer {
  addresses?: AddressResponse[];
  contactPoints?: ContactPointResponse[];
  relations?: RelationResponse[];
  fiscalProfile?: CustomerFiscalProfileResponse | null;
}

export interface AddAddressRequest {
  kind: AddressKind;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode: string;
  countryCode: string;
  isPrimary: boolean;
}

export interface AddContactPointRequest {
  type: ContactPointType;
  value: string;
  label?: string | null;
  isPrimary: boolean;
}

/**
 * Campos `address*` inferidos por convención de nombre a partir de
 * `AddAddressRequest` (la guía solo confirma el primero y el último:
 * `addressLine1?..addressCountryCode?`) — verificar contra un 400 real si
 * algún campo no calza.
 */
export interface AddRelationRequest {
  relationshipKind: RelationshipKind;
  purposes: number;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  primaryEmail?: string | null;
  primaryPhone?: string | null;
  dateOfBirth?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressRegion?: string | null;
  addressPostalCode?: string | null;
  addressCountryCode?: string | null;
}

/** Espejo de BuildingBlocks.Common.PagedResult<T>. Campo de tamaño de página: `size`, no `pageSize`. */
export interface PagedResult<T> {
  items: T[];
  page: number;
  size: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

/** Opción del catálogo curado de ocupaciones (`GET /customers/occupations`). */
export interface OccupationOption {
  id: string;
  name: string;
}

/** Opción del catálogo curado de actividades NAICS (`GET /customers/business-activities`). */
export interface BusinessActivityOption {
  id: string;
  naicsCode: string;
  description: string;
  sector: string | null;
}

/** Body de POST /customers. */
export interface CreateCustomerRequest {
  kind: CustomerKind;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  legalName?: string | null;
  businessStructure?: ApiBusinessStructure | null;
  dba?: string | null;
  /** yyyy-MM-dd (DateOnly). */
  formationDate?: string | null;
  principalBusinessActivityId?: string | null;
  /** yyyy-MM-dd (DateOnly). */
  dateOfBirth?: string | null;
  occupationId?: string | null;
  primaryEmail: string;
  primaryPhone?: string | null;
  language: CustomerLanguage;
  preferredChannel: PreferredChannel;
  /**
   * false (default) → si hay duplicado, 409 `Customer.DuplicateFound` con el id existente.
   * true → aplica los datos sobre el cliente existente (publica CustomerUpdated, no crea otro).
   */
  overwrite?: boolean;
}

/** GET /customers/check-exists?email=&taxIdentifier= — preflight de duplicados (email + tax id). */
export interface CustomerExistsResponse {
  emailExists: boolean;
  taxIdentifierExists: boolean;
  existingCustomerId: string | null;
}

/** Body de PATCH /customers/{id} — merge parcial: campos omitidos conservan el valor actual. */
export interface UpdateCustomerRequest {
  language: CustomerLanguage;
  preferredChannel: PreferredChannel;
  occupationId?: string | null;
  profilePictureFileId?: string | null;
  primaryEmail: string;
  primaryPhone?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  dateOfBirth?: string | null;
  legalName?: string | null;
  dba?: string | null;
  businessStructure?: ApiBusinessStructure | null;
  formationDate?: string | null;
  principalBusinessActivityId?: string | null;
}

/** Body de POST /customers/bulk/{statusAction}. */
export interface BulkStatusActionRequest {
  customerIds: string[];
  reason?: string | null;
}

/** Un fallo por-cliente dentro de una acción masiva (200 con fallos parciales). */
export interface BulkStatusFailure {
  customerId: string;
  errorCode: string;
  message: string;
}

/** Respuesta de POST /customers/bulk/{statusAction} — puede traer fallos parciales aunque el HTTP sea 200. */
export interface BulkStatusActionResponse {
  totalRequested: number;
  succeeded: number;
  failed: number;
  failures: BulkStatusFailure[];
}

/** Body de PUT /customers/{id}/fiscal-profile — SSN/ITIN/EIN. Requiere rol TenantAdmin en el backend. */
export interface SetCustomerFiscalProfileRequest {
  subjectKind: FiscalSubjectKind;
  /** Opcional al EDITAR: null conserva el identificador actual y solo actualiza filing/AGI/returning. */
  taxIdentifier: string | null;
  filingStatus?: string | null;
  priorYearAgi?: number | null;
  isReturningCustomer: boolean;
  refundBankAccount?: string | null;
  refundBankRouting?: string | null;
}

// ---------- Adaptadores backend -> shapes de UI existentes (client-table / client-profile) ----------

function toClientType(kind: CustomerKind): 'individual' | 'company' {
  return kind === 'Individual' ? 'individual' : 'company';
}

/** Fila de listado: el backend no devuelve address/ssn/ein en /customers, así que `individual`/`company` quedan sin esos datos. */
export function summaryToClientItem(summary: CustomerSummary): ClientItem {
  return {
    id: summary.id,
    type: toClientType(summary.kind),
    displayName: summary.displayName,
    email: summary.primaryEmail,
    phone: summary.primaryPhone ?? '',
    address: '',
    isActive: summary.status === 'Active',
    createdAt: summary.createdAtUtc.slice(0, 10),
  };
}

/** Detalle (GET /customers/{id} o respuesta de create/update): agrega occupation/principalBusinessActivity, que sí vienen en este DTO. */
export function customerToClientItem(customer: Customer): ClientItem {
  const base = summaryToClientItem(customer);
  if (customer.kind === 'Individual') {
    return {
      ...base,
      individual: {
        occupation: customer.occupationName ?? undefined,
        dateOfBirth: customer.dateOfBirth ?? undefined,
      },
    };
  }
  return { ...base, company: { principalBusinessActivity: customer.principalBusinessActivityName ?? undefined } };
}

/** relationshipKind es texto abierto en el backend — 'Spouse' es el único valor con significado especial en esta UI. */
function relationToDependent(relation: RelationResponse): { name: string; relationship: string; dateOfBirth: string } {
  return {
    name: relation.displayName,
    relationship: relation.relationshipKind,
    dateOfBirth: relation.dateOfBirth ?? '',
  };
}

/**
 * Detalle (GET /customers/{id}) → shape de la página de perfil.
 *
 * Las colecciones se leen con `?? []` porque el endpoint **no las devuelve**
 * (ver `CustomerDetailResponse`): desreferenciarlas directo tumbaba la página
 * entera con "Cannot read properties of undefined (reading 'find')".
 */
export function customerToClientProfile(customer: CustomerDetailResponse): ClientProfile {
  const base = customerToClientItem(customer);
  const relations = customer.relations ?? [];
  const spouseRelation = relations.find(r => r.relationshipKind === 'Spouse');
  return {
    id: base.id,
    type: base.type,
    displayName: base.displayName,
    email: base.email,
    phone: base.phone,
    language: customer.language,
    preferredChannel: customer.preferredChannel,
    isActive: base.isActive,
    createdAt: base.createdAt,
    individual: base.individual,
    company: base.company,
    addresses: customer.addresses ?? [],
    contactPoints: customer.contactPoints ?? [],
    relations,
    fiscalProfile: customer.fiscalProfile ?? null,
    dependents: relations.filter(r => r.id !== spouseRelation?.id).map(relationToDependent),
    spouse: spouseRelation
      ? {
          name: spouseRelation.displayName,
          dateOfBirth: spouseRelation.dateOfBirth ?? '',
          phone: spouseRelation.primaryPhone ?? undefined,
          email: spouseRelation.primaryEmail ?? undefined,
        }
      : undefined,
  };
}
