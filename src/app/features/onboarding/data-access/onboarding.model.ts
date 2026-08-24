/**
 * Contratos del alta PAGO-PRIMERO (PayFlow). A diferencia del wizard self-serve (features/signup),
 * acá el comprador PAGA antes de que exista el tenant: verifica su email por OTP → crea el
 * onboarding → aplica códigos (gift/promo/referido) opcionales → paga el NETO en Stripe (o queda
 * cubierto 100% sin pago) → recibe por email el link de registro. Endpoints /onboarding/* del gateway.
 */

/** Plan del catálogo público (GET /plans). Mismo shape que features/signup (una feature no importa de otra). */
export interface OnboardingPlan {
  id: string;
  code: string;
  name: string;
  description: string;
  tier: string;
  monthlyPriceUsd: number;
  supportedBillingCycles: string[];
  pricesUsdByCycle: Record<string, number>;
  maxUsers: number;
  maxPendingInvitations: number;
  storageQuotaBytes: number;
  enabledModules: string[];
}

/** POST /onboarding/email-challenges → 201 { challengeId }. */
export interface CreateChallengeResponse {
  challengeId: string;
}

/** POST /onboarding → 201 { onboardingId, email, planId }. */
export interface CreateOnboardingResponse {
  onboardingId: string;
  email: string;
  planId: string;
}

/**
 * POST /onboarding/checkout → 200. Si un código cubre el 100%, `fullyCovered=true` y NO hay
 * `checkoutUrl` (no se cobra nada, se dispara el email de registro). Si hay neto a pagar, `checkoutUrl`
 * es la sesión hosted de Stripe a la que se redirige. El desglose es null si no se aplicó ningún código.
 */
export interface StartCheckoutResponse {
  paymentId: string;
  checkoutUrl: string;
  expiresAtUtc: string;
  fullyCovered: boolean;
  grossAmountCents: number | null;
  discountAmountCents: number | null;
  netAmountCents: number | null;
  currency: string | null;
}

/** Códigos opcionales que el comprador puede aplicar (cada uno se apila contra el residual). */
export interface OnboardingCodes {
  referralCode?: string;
  promoCode?: string;
  giftCode?: string;
}

/** Datos de contacto del comprador (paso 1). */
export interface ContactDraft {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

/** Pasos del wizard pago-primero. */
export type OnboardingStep = 'contact' | 'otp' | 'plan' | 'pay' | 'done';

/** Alias del catálogo público para los componentes nuevos (signup-wizard/plan-picker). */
export type PlanResponse = OnboardingPlan;

/**
 * POST /onboarding/register/preview → 200. Identifica al comprador antes de pedirle
 * password/subdominio, sin exponer nunca el OnboardingId (el token es la única llave).
 */
export interface PreviewRegistrationResponse {
  firstName: string;
  lastName: string;
  maskedEmail: string;
  planName: string | null;
}

/**
 * POST /onboarding/subdomains/check → 200. Check-y-reserva en un solo paso: si está libre,
 * queda reservado (TTL 60 min) para este onboarding. `reason` es un código de error de
 * negocio (p.ej. Onboarding.SubdomainTaken), no un literal legible.
 */
export interface SubdomainReservationResponse {
  available: boolean;
  reason: string | null;
  expiresAtUtc: string | null;
}

/** POST /onboarding/register/complete → 202 { status, statusUrl }. */
export interface CompleteRegistrationResponse {
  status: string;
  statusUrl: string;
}

/** Estados del TenantOnboarding (espejo de TenantOnboardingStatus del backend). */
export type OnboardingStatusValue =
  | 'PendingPayment'
  | 'PaymentProcessing'
  | 'PaymentCompleted'
  | 'RegistrationPending'
  | 'Provisioning'
  | 'ProvisioningFailed'
  | 'ManualReview'
  | 'Completed'
  | 'PaymentFailed'
  | 'Cancelled'
  | 'Expired'
  | 'Refunded';

/** Paso de la Saga de provisioning (espejo de TenantProvisioningStep del backend). */
export type ProvisioningStep =
  | 'None'
  | 'Tenant'
  | 'TenantAdmin'
  | 'Subscription'
  | 'CloudStorage'
  | 'Subdomain'
  | 'Defaults'
  | 'Completed';

/** GET /onboarding/status?token= → 200. Polling público del provisioning post-registro. */
export interface OnboardingStatusResponse {
  status: OnboardingStatusValue;
  currentStep: ProvisioningStep | null;
  failureReason: string | null;
  failureCode: string | null;
  redirectUrl: string | null;
}

/**
 * Estados desde los que la Saga ya no avanza sola (con `Completed` como único final feliz).
 * `ProvisioningFailed`/`ManualReview` los retoma el backend u operaciones — el navegador
 * deja de sondear y muestra el mensaje de "te avisamos por email".
 */
const TERMINAL_STATUSES: readonly OnboardingStatusValue[] = [
  'Completed',
  'ProvisioningFailed',
  'ManualReview',
  'PaymentFailed',
  'Cancelled',
  'Expired',
  'Refunded',
];

export function isTerminalStatus(status: OnboardingStatusValue): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Filas del progreso de provisioning, en el orden real de la Saga. `None` y `Completed`
 * no son filas: uno es "todavía no arrancó" y el otro lo representa la pantalla de éxito.
 */
export const PROVISIONING_STEPS: ReadonlyArray<{ step: ProvisioningStep; label: string }> = [
  { step: 'Tenant', label: 'Creating your office' },
  { step: 'TenantAdmin', label: 'Setting up your admin account' },
  { step: 'Subscription', label: 'Activating your subscription' },
  { step: 'CloudStorage', label: 'Preparing your document storage' },
  { step: 'Subdomain', label: 'Publishing your web address' },
  { step: 'Defaults', label: 'Applying finishing touches' },
];

/** GET /auth/onboarding/terms/current → 200. Versión legal vigente que el comprador acepta. */
export interface TermsVersionResponse {
  termsVersionId: string;
  kind: string;
  version: string;
  contentUri: string | null;
  contentHash: string | null;
  locale: string;
  effectiveFromUtc: string;
  effectiveUntilUtc: string | null;
}
