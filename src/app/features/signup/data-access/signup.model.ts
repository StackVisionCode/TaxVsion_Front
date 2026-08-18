/**
 * Contratos del alta self-service (wizard público). Reflejan el camino real del backend
 * verificado end-to-end: reservar subdominio → crear tenant con ticket → aceptar invitación →
 * login (con enrolamiento MFA) → suscripción trial → pago.
 */

/** Plan del catálogo público (GET /plans). Igual shape que features/plans, redefinido aquí
 *  porque una feature no importa de otra (ver ARCHITECTURE.md). */
export interface SignupPlan {
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

/** GET /auth/subdomains/check-availability?slug= */
export interface SubdomainAvailability {
  slug: string;
  available: boolean;
  reason?: string | null;
}

/** POST /auth/subdomains/reserve → el ticket firmado que exige POST /tenants. */
export interface SubdomainReservation {
  slug: string;
  reservedByEmail: string;
  expiresAtUtc: string;
  registrationTicket: string;
}

/** POST /tenants → adminActivationToken es el token de invitación del admin (raw). */
export interface CreatedTenant {
  id: string;
  name: string;
  subdomain: string;
  defaultTimeZoneId: string;
  adminActivationToken: string;
  adminInvitationExpiresAtUtc: string;
}

/** Datos que el usuario completa en el paso "cuenta". */
export interface AccountDraft {
  companyName: string;
  subdomain: string;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}

/** Pasos del wizard. */
export type SignupStep = 'plan' | 'account' | 'done';
