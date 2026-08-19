/** Resumen de la suscripción del tenant (GET /subscriptions/me). */
export interface SubscriptionSummary {
  planCode: string;
  planName: string;
  status: string;
  billingCycle: string;
  monthlyPriceUsd: number;
  currentCyclePriceUsd: number;
  maxUsers: number;
  storageQuotaBytes: number;
  enabledModules: string[];
  trialEndsAtUtc?: string | null;
}

/** Tarjetas de prueba de Stripe (referencias de PaymentMethod que el backend acepta en test mode). */
export interface TestCard {
  label: string;
  brand: string;
  number: string;
  reference: string;
}

export type CheckoutPhase = 'idle' | 'paying' | 'confirming' | 'done' | 'error';
