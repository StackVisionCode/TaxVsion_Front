/** Plan del catálogo de suscripción (GET /plans del gateway; ver Subscription/Catalog en el backend). */
export interface Plan {
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
