/**
 * Modelos del ciclo de vida de la suscripción de la firma (Expiración/Dunning, Fase 5).
 * Reflejan el `MySubscriptionResponse` enriquecido y el flujo de renovación self-service del backend.
 */

/** Último fallo de cobro de renovación (proyectado del renewal más reciente con FailureCode). */
export interface LastPaymentFailure {
  code: string;
  reason: string;
  retryCount: number;
  nextRetryAtUtc?: string | null;
  failedAtUtc?: string | null;
}

/** GET /subscriptions/me — enriquecido en Fase 4 con los campos del lapso. `status` es string (enum del backend). */
export interface MySubscription {
  planCode: string;
  planName: string;
  status: string;
  billingCycle: string;
  monthlyPriceUsd: number;
  currentCyclePriceUsd: number;
  maxUsers: number;
  maxPendingInvitations: number;
  storageQuotaBytes: number;
  enabledModules: string[];
  trialEndsAtUtc?: string | null;
  currentPeriodStartUtc: string;
  currentPeriodEndUtc: string;
  cancelledAtUtc?: string | null;
  nextRenewalAtUtc?: string | null;
  gracePeriodEndsAtUtc?: string | null;
  suspendedAtUtc?: string | null;
  expiredAtUtc?: string | null;
  suspensionReason?: string | null;
  lastPaymentFailure?: LastPaymentFailure | null;
  billingAccessBlocked: boolean;
}

/** POST /subscriptions/me/renew-checkout */
export interface StartRenewCheckoutRequest {
  payerEmail: string;
  successUrl: string;
  cancelUrl: string;
  provider?: string;
  method?: string;
}

export interface StartRenewCheckoutResponse {
  renewalIntentId: string;
  checkoutUrl: string;
  paymentId: string;
  expiresAtUtc: string;
}

/** GET /subscriptions/me/renew-checkout/{intentId} — Pending | Paid | Provisioned | Failed. */
export interface RenewCheckoutStatusResponse {
  renewalIntentId: string;
  status: string;
  amountCents: number;
  currency: string;
  checkoutUrl: string | null;
}

/** Severidad del banner por estado — decide color y prominencia. */
export type SubscriptionTone = 'ok' | 'warning' | 'critical';

/** Estados que consumen banner. Active/Trialing/Cancelled no muestran nada (o lo maneja otra UX). */
const WARNING = ['pastdue', 'graceperiod'];
const CRITICAL = ['suspended', 'expired'];

export function toneForStatus(status: string | null | undefined): SubscriptionTone {
  const s = (status ?? '').toLowerCase();
  if (CRITICAL.includes(s)) return 'critical';
  if (WARNING.includes(s)) return 'warning';
  return 'ok';
}
