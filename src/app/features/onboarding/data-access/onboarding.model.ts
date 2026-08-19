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
