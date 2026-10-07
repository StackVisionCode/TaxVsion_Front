import { formatMoney } from '@shared/utils/format.util';
import type { StatusTone } from '@shared/ui/status-pill/status-pill.component';

/**
 * DTOs del servicio `TaxVision.Wallet` (vía Gateway) + helpers de presentación co-locados (patrón de
 * `billing.model.ts`). Los montos van en **micros** (millonésimas de USD, `long` → `number` en JSON;
 * caben en el entero seguro de JS para saldos reales). `formatMicros` los pasa a "$X.XX".
 */

// ---------- Saldo ----------
export interface WalletView {
  postedMicros: number;
  heldMicros: number;
  availableMicros: number;
  currency: string;
  status: string; // Active | Frozen
  updatedAtUtc: string;
}

// ---------- Ledger ----------
export type WalletMovement = 'TopUp' | 'Reserve' | 'Consume' | 'Release' | 'UsageRefund' | 'Adjustment';

export interface LedgerEntryView {
  id: string;
  movement: WalletMovement;
  deltaPostedMicros: number;
  deltaHeldMicros: number;
  postedAfterMicros: number;
  heldAfterMicros: number;
  operationKey: string;
  referenceId: string | null;
  createdAtUtc: string;
}

// ---------- Recargas ----------
export type TopUpStatus = 'Pending' | 'Credited' | 'Failed';

export interface TopUpView {
  id: string;
  amountCents: number;
  currency: string;
  status: TopUpStatus;
  createdAtUtc: string;
  updatedAtUtc: string;
}

/** Proveedor de pago para el checkout hosteado (nunca se guarda tarjeta). */
export type TopUpProvider = 'Stripe' | 'PayPal';

export interface TopUpRequest {
  amountCents: number;
  currency?: string;
  payerEmail: string;
  successUrl: string;
  cancelUrl: string;
  provider: TopUpProvider;
  /** Método canónico de PaymentApp: Card (Stripe) o Wallet (PayPal). */
  method: 'Card' | 'Wallet';
}

/** Respuesta de `POST /wallet/top-ups`: la orden + la URL del proveedor a la que redirigir. */
export interface TopUpCheckoutView {
  topUp: TopUpView;
  checkoutUrl: string;
  expiresAtUtc: string;
}

// ---------- Pricing / estimación ----------
export interface RateView {
  channel: string; // Email | Sms | Push | WhatsApp
  unitPriceMicros: number;
}

export interface RatesView {
  version: number;
  effectiveFromUtc: string;
  rates: RateView[];
}

export interface PerChannelUnits {
  email?: number;
  sms?: number;
  push?: number;
  whatsApp?: number;
}

export interface EstimateLine {
  channel: string;
  units: number;
  unitPriceMicros: number;
  subtotalMicros: number;
}

export interface EstimateView {
  priceBookVersion: number;
  costMicros: number;
  availableMicros: number;
  sufficient: boolean;
  deficitMicros: number;
  currency: string;
  perChannel: EstimateLine[];
}

// ---------- Paginado (espejo del PagedResult<T> del backend) ----------
export interface PagedResult<T> {
  items: T[];
  page: number;
  size: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

// ---------- Helpers de dinero (micros) ----------
export const MICROS_PER_DOLLAR = 1_000_000;

/**
 * Micros → "$X.XX". Con `maxFraction = 2` (saldos) delega en el `formatMoney` compartido; con más
 * decimales (tarifas sub-céntimo, p.ej. $0.0050) usa `Intl` directo para no perder precisión.
 */
export function formatMicros(
  micros: number | null | undefined,
  currency = 'USD',
  maxFraction = 2,
): string {
  const dollars = Number(micros ?? 0) / MICROS_PER_DOLLAR;
  if (maxFraction <= 2) {
    return formatMoney(dollars, currency);
  }
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: maxFraction,
    }).format(dollars);
  } catch {
    return formatMoney(dollars, 'USD');
  }
}

/** Dólares (input del usuario) → centavos para `POST /wallet/top-ups`. */
export function dollarsToCents(dollars: number): number {
  return Math.round((dollars || 0) * 100);
}

/** Micros → dólares exactos (para precargar el input de recarga desde un déficit). */
export function microsToDollars(micros: number | null | undefined): number {
  return Number(micros ?? 0) / MICROS_PER_DOLLAR;
}

// ---------- Presentación del ledger ----------
export interface MovementPresentation {
  label: string;
  tone: StatusTone;
}

const MOVEMENT_PRESENTATION: Readonly<Record<WalletMovement, MovementPresentation>> = {
  TopUp: { label: 'Top-up', tone: 'success' },
  Reserve: { label: 'Reserved', tone: 'info' },
  Consume: { label: 'Charged', tone: 'brand' },
  Release: { label: 'Released', tone: 'neutral' },
  UsageRefund: { label: 'Refund', tone: 'success' },
  Adjustment: { label: 'Adjustment', tone: 'warning' },
};

export function movementPresentation(movement: WalletMovement): MovementPresentation {
  return MOVEMENT_PRESENTATION[movement] ?? { label: movement, tone: 'neutral' };
}

const TOPUP_TONE: Readonly<Record<TopUpStatus, StatusTone>> = {
  Pending: 'warning',
  Credited: 'success',
  Failed: 'danger',
};

export function topUpTone(status: TopUpStatus): StatusTone {
  return TOPUP_TONE[status] ?? 'neutral';
}
