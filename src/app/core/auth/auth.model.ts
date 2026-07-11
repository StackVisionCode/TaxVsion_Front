/** Cuerpo de POST /auth/login. `tenantId` es obligatorio (lo aporta environment). */
export interface LoginRequest {
  tenantId: string;
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

export interface Tenant {
  id: string;
  name: string;
  subDomain: string;
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
