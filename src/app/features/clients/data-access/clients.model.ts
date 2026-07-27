import { ClientItem } from '../ui/client-table/client-table.component';
import { ClientProfile } from '../models/client-profile.model';

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
  createdAtUtc: string;
  assignedPreparerUserId: string | null;
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

/** Body de PUT /customers/{id}/fiscal-profile — SSN/ITIN/EIN. Requiere rol TenantAdmin en el backend. */
export interface SetCustomerFiscalProfileRequest {
  subjectKind: FiscalSubjectKind;
  taxIdentifier: string;
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
    return { ...base, individual: { occupation: customer.occupationName ?? undefined } };
  }
  return { ...base, company: { principalBusinessActivity: customer.principalBusinessActivityName ?? undefined } };
}

export function customerToClientProfile(customer: Customer): ClientProfile {
  const base = customerToClientItem(customer);
  return { ...base };
}
