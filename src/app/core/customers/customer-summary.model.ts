/**
 * DTO canónico del cliente compartido entre módulos (mail, task, signature, sms, billing, documents…).
 * Espejo de CustomerSummaryResponse de Customer.Api. Reemplaza las réplicas por-feature.
 */

export type CustomerKind = 'Individual' | 'Business';
export type CustomerStatus = 'Active' | 'Inactive' | 'Archived';

/** Query param `status` de GET /customers. */
export type CustomerStatusFilter = 'Active' | 'Inactive' | 'Archived' | 'NotArchived' | 'All';

export interface CustomerSummary {
  id: string;
  kind: CustomerKind;
  status: CustomerStatus;
  displayName: string;
  primaryEmail: string;
  primaryPhone: string | null;
  createdAtUtc: string;
}

/** Espejo de BuildingBlocks.Common.PagedResult<T> (campo `size`, no `pageSize`). */
export interface PagedResult<T> {
  items: T[];
  page: number;
  size: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

/** Parámetros de GET /customers. */
export interface CustomerSearchParams {
  term?: string;
  status?: CustomerStatusFilter;
  page?: number;
  size?: number;
}

/** Altas de clientes de un mes (GET /customers/overview). `year`/`month` en UTC. */
export interface MonthlyNewCustomers {
  year: number;
  month: number;
  count: number;
}

/** GET /customers/overview — resumen del dashboard (total exacto + altas por mes + últimas altas). */
export interface CustomerDirectoryOverview {
  totalCount: number;
  monthly: MonthlyNewCustomers[];
  recent: CustomerSummary[];
}
