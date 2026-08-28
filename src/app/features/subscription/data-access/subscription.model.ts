/**
 * Contratos del servicio Subscription (Gateway: `/entitlements`, `/seats`, `/addons`, `/audit`).
 *
 * Espejo 1:1 de los `record` del backend — verificado el 2026-08-28 contra
 * `TaxVision.Subscription.Api/Controllers/*`. Los enums viajan como STRING
 * (`JsonStringEnumConverter`), por eso `status`/`type`/`billingCycle` son `string`
 * y no uniones cerradas: el backend puede sumar valores y una unión estricta
 * rompería el parseo en vez de degradar.
 */

/** `PagedResult<T>` del backend — ojo: el campo es `size`, no `pageSize`. */
export interface PagedResult<T> {
  items: T[];
  page: number;
  size: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

// ---------- Entitlements ----------

export interface EntitlementValueResponse {
  valueType: string;
  value: string;
  status: string;
  source: string;
  expiresAtUtc: string | null;
}

export interface EntitlementSummaryResponse {
  tenantId: string;
  revisionNumber: number;
  computedAtUtc: string;
  planCode: string;
  subscriptionStatus: string;
  seatCount: number;
  availableSeatCount: number;
  /** Diccionario clave→valor; la clave es el identificador del límite (p. ej. "customers.max"). */
  entries: Record<string, EntitlementValueResponse>;
}

/** Fila derivada de `entries` para poder listar/ordenar en la tabla. */
export interface EntitlementRow extends EntitlementValueResponse {
  key: string;
}

// ---------- Seats ----------

export interface SeatResponse {
  id: string;
  type: string;
  status: string;
  sourceType: string;
  sourceReferenceId: string | null;
  purchasedAtUtc: string;
  currentPeriodStartUtc: string | null;
  currentPeriodEndUtc: string | null;
  nextRenewalAtUtc: string | null;
  autoRenew: boolean;
  billingCycle: string;
  currentUserId: string | null;
  currentUserAssignedAtUtc: string | null;
}

export interface PurchaseSeatsRequest {
  seatType: string;
  quantity: number;
  autoRenew: boolean;
}

export interface AssignSeatRequest {
  userId: string;
}

export interface ReleaseSeatRequest {
  reason: string | null;
}

export interface ReassignSeatRequest {
  toUserId: string;
  reason: string | null;
}

// ---------- Add-ons ----------

export interface AddOnDefinitionResponse {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  allowMultipleInstances: boolean;
}

export interface AddOnResponse {
  id: string;
  addOnCode: string;
  status: string;
  quantity: number;
  billingCycle: string;
  currentPeriodStartUtc: string;
  currentPeriodEndUtc: string;
  nextRenewalAtUtc: string | null;
  autoRenew: boolean;
  purchasedAtUtc: string;
}

export interface PurchaseAddOnRequest {
  addOnCode: string;
  quantity: number;
  autoRenew: boolean;
}

export interface CancelAddOnRequest {
  /** Obligatorio en el backend (`record CancelAddOnRequest(string Reason)`). */
  reason: string;
}

// ---------- Audit ----------

export interface AuditLogEntryResponse {
  id: string;
  aggregateType: string;
  aggregateId: string;
  action: string;
  actorUserId: string;
  actorType: string;
  occurredAtUtc: string;
  correlationId: string | null;
  beforePayload: string | null;
  afterPayload: string | null;
  reason: string | null;
}

export interface AuditSearchFilters {
  aggregateType: string | null;
  from: string | null;
  to: string | null;
}

// ---------- Helpers de presentación ----------

/** Valores reales de `SeatType` (Domain/Seats/SeatType.cs). */
export const SEAT_TYPES = ['Standard', 'Portal', 'Signature', 'ReadOnly', 'ServiceAccount'];

/** Valores reales de `SeatStatus` (Domain/Seats/SeatStatus.cs). */
export const SEAT_STATUSES = [
  'Available',
  'Assigned',
  'Active',
  'PastDue',
  'GracePeriod',
  'Suspended',
  'Cancelled',
  'Expired',
  'Released',
];

const ACTIVE_STATES = ['active', 'assigned', 'available'];
const WARNING_STATES = ['pastdue', 'graceperiod', 'suspended'];
const ENDED_STATES = ['cancelled', 'canceled', 'expired', 'released'];

/**
 * Tono visual del estado. Se compara en minúsculas y cualquier valor que el
 * backend agregue en el futuro cae en `neutral` en vez de pintarse como error.
 */
export function statusTone(status: string): 'active' | 'warning' | 'ended' | 'neutral' {
  const value = status?.toLowerCase() ?? '';
  if (ACTIVE_STATES.includes(value)) {
    return 'active';
  }
  if (WARNING_STATES.includes(value)) {
    return 'warning';
  }
  if (ENDED_STATES.includes(value)) {
    return 'ended';
  }
  return 'neutral';
}

/** Un asiento se puede asignar solo si no lo tiene nadie hoy. */
export function isAssignable(seat: SeatResponse): boolean {
  return !seat.currentUserId && statusTone(seat.status) !== 'ended';
}

/** `entries` es un diccionario; la tabla necesita filas ordenadas por clave. */
export function toEntitlementRows(summary: EntitlementSummaryResponse | null): EntitlementRow[] {
  if (!summary?.entries) {
    return [];
  }
  return Object.entries(summary.entries)
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Los límites numéricos llegan como string. Se muestran formateados solo cuando
 * de verdad son un número; si no, se respeta el texto tal cual (puede ser
 * "unlimited", un booleano o un JSON).
 */
export function formatEntitlementValue(entry: EntitlementValueResponse): string {
  const raw = entry.value ?? '';
  if (entry.valueType?.toLowerCase() === 'boolean') {
    return raw.toLowerCase() === 'true' ? 'Enabled' : 'Disabled';
  }
  const asNumber = Number(raw);
  if (raw.trim() !== '' && Number.isFinite(asNumber)) {
    return asNumber.toLocaleString();
  }
  return raw || '—';
}

/** "customers.max" → "Customers max", para no mostrarle claves crudas al usuario. */
export function humanizeKey(key: string): string {
  const words = key.replace(/[._-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
