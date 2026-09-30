/**
 * Asientos de la suscripción, tal como los usa la administración de usuarios: comprarlos y decidir quién
 * ocupa cada uno. Los montos vienen en centavos y el precio SIEMPRE lo resuelve el backend.
 */

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

/**
 * Respuesta de `GET /seats/quote` — espejo de `SeatQuoteResponse` (backend). Montos en centavos
 * (enteros). `proratedUnitAmountCents` es lo que se cobra HOY por asiento (prorrateado a lo que resta del
 * período vigente); `unitAmountCents` es el precio de período completo de cada renovación. El precio
 * SIEMPRE lo calcula el backend — el cliente nunca lo computa.
 */
export interface SeatQuoteResponse {
  seatType: string;
  quantity: number;
  billingCycle: string;
  unitAmountCents: number;
  proratedUnitAmountCents: number;
  proratedTotalCents: number;
  currency: string;
  currentPeriodEndUtc: string;
}

/**
 * Resultado de iniciar una compra de asientos. `charged` = cobro off-session del método en archivo;
 * `redirect` = hosted-checkout (Stripe/PayPal) para cuando el tenant no tenga método en archivo.
 */
export type SeatPurchaseOutcome =
  | { status: 'charged'; seatIds: string[] }
  | { status: 'redirect'; url: string; intentId: string };

/** Cuerpo de `POST /seats/checkout` (compra por redirect). */
export interface StartSeatCheckoutRequest {
  seatType: string;
  quantity: number;
  autoRenew: boolean;
  payerEmail: string;
  successUrl: string;
  cancelUrl: string;
  provider?: string;
  method?: string;
}

/** Respuesta de `POST /seats/checkout` — la URL a la que redirigir. */
export interface StartSeatCheckoutResponse {
  seatPurchaseIntentId: string;
  checkoutUrl: string;
  paymentId: string;
  expiresAtUtc: string;
}

/** Estado de una intención de checkout (`GET /seats/checkout/{id}`). El front lo poll-ea al volver del
 *  redirect hasta ver `Provisioned` (éxito) o `Failed`. */
export interface SeatCheckoutStatusResponse {
  seatPurchaseIntentId: string;
  status: string; // Pending | Paid | Provisioned | Failed
  seatType: string;
  quantity: number;
  proratedTotalCents: number;
  currency: string;
  checkoutUrl: string | null;
}

/** Método de pago guardado del tenant — espejo de `SavedPaymentMethodResponse` (PaymentApp). */
export interface SavedPaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

/** `GET /payments-app/provider-customers/{provider}` — para saber si hay tarjeta en archivo. 404 = ninguna. */
export interface ProviderCustomer {
  id: string;
  providerCode: string;
  email: string;
  savedMethods: SavedPaymentMethod[];
}

// ---------- Helpers de presentación ----------

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
