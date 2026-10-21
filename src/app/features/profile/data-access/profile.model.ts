/**
 * Espejos de los DTOs del servicio Auth que consume la página de perfil.
 * Fuente: UsersController / CredentialsController / SessionsController
 * (TaxVsion_BackEnd/src/Services/Auth/Api/Controllers). JSON camelCase.
 */

/** Body de PUT /auth/users/me/profile (UsersController.UpdateMyProfileRequest) — 204. */
export interface UpdateMyProfileRequest {
  name: string;
  lastName: string;
  timeZoneId?: string | null;
}

/** Body de POST /auth/password/change (CredentialsController.ChangePasswordRequest) — 204. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Política del backend (PasswordPolicy.MinLength) — se replica solo para validar en cliente. */
export const PASSWORD_MIN_LENGTH = 12;

/** Fila de GET /auth/sessions/me (SessionResponse de Sessions/Queries/GetSessions.cs). */
export interface UserSession {
  id: string;
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAtUtc: string;
  lastSeenAtUtc: string;
}

/** Body de POST /auth/me/email/change-request (RequestEmailChangeRequest) — 202. */
export interface RequestEmailChangeRequest {
  newEmail: string;
}

/**
 * Body de POST /auth/me/email/confirm (ConfirmEmailChangeCommand). `token` es el
 * token que llega al correo NUEVO (válido 1 hora, un solo uso).
 */
export interface ConfirmEmailChangeRequest {
  token: string;
}

/** Body de POST /auth/me/phone/change-request (RequestPhoneVerificationRequest) — 202 (OTP por SMS, 10 min). */
export interface RequestPhoneVerificationRequest {
  phoneNumber: string;
}

/** Body de POST /auth/me/phone/confirm (ConfirmPhoneRequest). `code` es el OTP numérico del SMS. */
export interface ConfirmPhoneRequest {
  code: string;
}

/**
 * El backend serializa DateTime UTC sin sufijo de zona en algunos entornos;
 * se fuerza la 'Z' para que el DatePipe lo muestre en hora local correcta.
 */
export function toUtcIso(value: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
}

/**
 * Etiqueta legible del dispositivo: deviceName si existe, si no se deriva del
 * user-agent. Acepta cualquier objeto con esos dos campos para poder reusarse
 * con los dispositivos de confianza de MFA (que no traen deviceName).
 */
export function sessionDeviceLabel(session: Pick<UserSession, 'deviceName' | 'userAgent'>): string {
  const named = session.deviceName?.trim();
  if (named) {
    return named;
  }
  const ua = session.userAgent ?? '';
  const browser = ua.includes('Edg/')
    ? 'Edge'
    : ua.includes('OPR/') || ua.includes('Opera')
      ? 'Opera'
      : ua.includes('Firefox/')
        ? 'Firefox'
        : ua.includes('Chrome/') || ua.includes('CriOS/')
          ? 'Chrome'
          : ua.includes('Safari/')
            ? 'Safari'
            : null;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : ua.includes('Android')
      ? 'Android'
      : ua.includes('Windows')
        ? 'Windows'
        : ua.includes('Mac OS X')
          ? 'macOS'
          : ua.includes('Linux')
            ? 'Linux'
            : null;
  if (browser && os) {
    return `${browser} on ${os}`;
  }
  return browser ?? os ?? 'Unknown device';
}

/** true si el user-agent parece un dispositivo móvil (para elegir icono). */
export function sessionIsMobile(session: Pick<UserSession, 'userAgent'>): boolean {
  return /iPhone|iPad|iPod|Android|Mobile/.test(session.userAgent ?? '');
}

/** Nombre legible del rol (actorType de /auth/me): "TenantAdmin" no le dice nada a nadie. */
export function roleDisplayName(actorType: string | null | undefined): string {
  switch (actorType) {
    case 'TenantAdmin':
      return 'Office admin';
    case 'TenantEmployee':
      return 'Team member';
    case 'PlatformAdmin':
      return 'Platform admin';
    case 'CustomerPortal':
      return 'Client';
    default:
      return actorType || 'Member';
  }
}

export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

/**
 * Fuerza orientativa para el medidor: 0 = no llega al mínimo del backend; luego suma por largo extra y
 * por variedad (mayúsculas+minúsculas, números, símbolos). No reemplaza la validación del servidor.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return 0;
  }
  let score = 1;
  if (password.length >= PASSWORD_MIN_LENGTH + 4) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4) as PasswordStrength;
}

/** IP para mostrar: las de loopback son "este equipo", no un número que nadie reconoce. */
export function sessionLocationLabel(ipAddress: string | null | undefined): string | null {
  const ip = ipAddress?.trim();
  if (!ip) {
    return null;
  }
  if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') {
    return 'This computer';
  }
  return ip;
}

/** Días enteros que faltan para `isoUtc` (negativo si ya pasó). */
export function daysUntil(isoUtc: string, now: Date = new Date()): number {
  return Math.ceil((new Date(toUtcIso(isoUtc)).getTime() - now.getTime()) / 86_400_000);
}
