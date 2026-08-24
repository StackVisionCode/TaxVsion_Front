/**
 * Contratos del backend Growth (bounded context Referrals) expuestos vía Gateway.
 *
 * Inventario de endpoints públicos (ReferralsController, `/growth/referrals`):
 *  - POST /growth/referrals/codes         → get-or-create idempotente del código del tenant.
 *  - POST /growth/referrals/attributions  → el tenant REFERIDO registra el código de quien lo refirió.
 *
 * NO existe ningún GET público para listar referidos/atribuciones/grants ni para
 * recuperar el código propio (gap del backend, ver referrals.store.ts). Los endpoints
 * `/internal/*` son M2M y no pasan por el Gateway.
 */

/**
 * ReferralProgram Platform + TenantToTenant que exige IssueTenantReferralCodeHandler.
 * No hay endpoint HTTP para listar/crear programas (CreateTenantReferralProgramCommand
 * existe en Application pero ningún controller lo expone): el programa se siembra en SQL
 * y este GUID es el mismo `growthReferralProgramId` de la colección Postman de Growth.
 * Idealmente vendría de environment/config del sistema — al no existir esa pieza, vive
 * acá como único punto de cambio.
 */
export const REFERRAL_PROGRAM_ID = 'a1a2a3a4-0000-0000-0000-000000000001';

/**
 * Expiración fija del código emitido. DEBE ser estable: el fingerprint de idempotencia
 * del backend incluye ExpiresAtUtc, así que cambiar este valor sin subir la versión de
 * {@link referralCodeIdempotencyKey} rompería el replay (Growth.Idempotency.FingerprintConflict).
 * Debe ser futura y ≤ EndsAtUtc del programa si éste define fin.
 */
export const REFERRAL_CODE_EXPIRES_AT_UTC = '2030-01-01T00:00:00Z';

/** Cuerpo de POST /growth/referrals/codes (IssueCodeRequest del controller). */
export interface IssueReferralCodeRequest {
  programId: string;
  /** ISO-8601 con sufijo Z: el handler rechaza fechas que no deserialicen como UTC. */
  expiresAtUtc: string;
}

/** ReferralCodeStatus del dominio, serializado como string (Status.ToString()). */
export type ReferralCodeStatus = 'Active' | 'Revoked' | 'Expired';

/**
 * Respuesta 200 de POST /growth/referrals/codes. `referralCode` es el texto plano:
 * el backend lo recalcula (determinista sobre ProgramId+TenantId+Idempotency-Key) en
 * cada llamada con la MISMA Idempotency-Key, así que no hay "one-time reveal".
 */
export interface IssueReferralCodeResponse {
  referralCodeId: string;
  programId: string;
  status: ReferralCodeStatus;
  displayPrefix: string;
  lastFour: string;
  expiresAtUtc: string;
  referralCode: string;
}

/** Cuerpo de POST /growth/referrals/attributions (lado del tenant referido). */
export interface CreateReferralAttributionRequest {
  programId: string;
  referralCode: string;
}

/** Descuento de bienvenida del referido (opción B). Null si el programa no lo configura o si su emisión best-effort falló. */
export interface RefereeBenefitInfo {
  codeDefinitionId: string;
  displayPrefix: string;
  lastFour: string;
  expiresAtUtc: string;
  /** Texto plano del código de descuento — se revela UNA sola vez en esta respuesta. */
  code: string;
}

/** Respuesta 200 de POST /growth/referrals/attributions. */
export interface CreateReferralAttributionResponse {
  attributionId: string;
  /** ReferralAttributionStatus.ToString() (p.ej. "Active"). */
  status: string;
  wasReplay: boolean;
  refereeBenefit: RefereeBenefitInfo | null;
}

/** Error del backend cuando ya existe un código Active y la Idempotency-Key no coincide con la original. */
export const REFERRAL_ACTIVE_OWNER_EXISTS = 'ReferralCode.ActiveOwnerExists';

/**
 * Idempotency-Key determinista (≤200 chars) para el get-or-create del código.
 * El fingerprint del backend incluye ActorUserId, así que la clave va por USUARIO:
 * el mismo usuario siempre replay-ea su emisión original; otro usuario del mismo
 * tenant no puede reemitir (recibe {@link REFERRAL_ACTIVE_OWNER_EXISTS}) y cae al
 * caché local del store. Subir `v1` si cambia {@link REFERRAL_CODE_EXPIRES_AT_UTC}.
 */
export function referralCodeIdempotencyKey(tenantId: string, userId: string, programId: string): string {
  return `referral-code:v1:${tenantId}:${programId}:${userId}`;
}

/**
 * Enlace compartible. El wizard pago-primero vive en `/register`; el backend no
 * documenta un formato de link de referido, así que se asume `?referral=<code>`.
 * OJO (follow-up): hoy el wizard de /register NO lee `?referral=` ni manda
 * referralCode en el checkout (solo la página vieja de /onboarding lee `?ref=`).
 */
export function buildReferralLink(referralCode: string): string {
  return `${window.location.origin}/register?referral=${encodeURIComponent(referralCode)}`;
}
