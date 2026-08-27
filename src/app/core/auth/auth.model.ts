/** Cuerpo de POST /auth/login. `tenantId` es obligatorio (lo aporta environment). */
export interface LoginRequest {
  /**
   * Opcional: en producción el tenant lo resuelve el backend por el Host del
   * subdominio y este campo NO se manda. Es `Guid?` en el contrato, así que una
   * cadena vacía haría fallar la deserialización con 400 — ver `AuthService.login`.
   */
  tenantId?: string | null;
  email: string;
  password: string;
  deviceName?: string | null;
  deviceToken?: string | null;
}

/** AuthTokensResponse del backend: login (desenlace c), refresh y verify MFA. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  /** Solo no-nulo cuando se marcó "recordar dispositivo" con un código no-recovery. */
  deviceToken?: string | null;
}

/** LoginResponse polimórfica: tokens, o reto MFA, o enrolamiento requerido. */
export interface LoginResponse {
  mfaRequired: boolean;
  mfaSetupRequired: boolean;
  tokens: AuthTokens | null;
  loginTicket: string | null;
  mfaMethods: string[] | null;
  ticketExpiresInSeconds: number | null;
}

/** Cuerpo de POST /auth/refresh. */
export interface RefreshRequest {
  refreshToken: string;
}

/** Cuerpo de POST /auth/password/forgot. Siempre responde 202, exista o no el email (anti-enumeración). */
export interface ForgotPasswordRequest {
  email: string;
  tenantId?: string | null;
}

/**
 * Cuerpo de POST /auth/password/reset. `token` es el valor de la query string
 * `?token=` del link que el usuario recibe por correo (`{portal}/reset-password?token=...`),
 * no un código que el usuario escribe — no hay paso intermedio de "verificar código".
 */
export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface Tenant {
  id: string;
  name: string;
  subDomain: string;
}

/** GET /auth/tenant/terms/status. */
export interface TermsAcceptanceStatusResponse {
  accepted: boolean;
  currentVersion: string;
  acceptedVersion: string | null;
  acceptedAtUtc: string | null;
}

/** POST /auth/tenant/terms/accept. */
export interface TermsAcceptanceResponse {
  termsVersion: string;
  acceptedAtUtc: string;
}

/** GET /auth/onboarding/terms/current — versión vigente de un documento legal (ToS/Privacy). */
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

export interface Plan {
  code: string;
  maxUsers: number;
  activeUsers: number;
  pendingInvitations: number;
  isSuspendedForBilling: boolean;
  enabledModules: string[];
}

/** GET /auth/me. */
export interface MeResponse {
  id: string;
  name: string;
  lastName: string;
  email: string;
  actorType: string;
  customerId: string | null;
  tenant: Tenant;
  roles: string[];
  permissions: string[];
  timeZoneId: string;
  mfaEnabled: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  phoneNumber: string | null;
  plan: Plan | null;
}
