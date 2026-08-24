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

/** Etiqueta legible del dispositivo: deviceName si existe, si no se deriva del user-agent. */
export function sessionDeviceLabel(session: UserSession): string {
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
export function sessionIsMobile(session: UserSession): boolean {
  return /iPhone|iPad|iPod|Android|Mobile/.test(session.userAgent ?? '');
}
