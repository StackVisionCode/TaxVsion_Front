export type MfaMethodType = 'Totp' | 'Email' | 'Sms';

/** Cuerpo de POST /auth/mfa/verify. Enviar `code` O `recoveryCode` (uno de los dos). */
export interface VerifyMfaRequest {
  loginTicket: string;
  code?: string | null;
  recoveryCode?: string | null;
  rememberDevice?: boolean;
  deviceName?: string | null;
}

/** POST /auth/mfa/totp/setup (Bearer). El QR se dibuja desde `otpAuthUri`. */
export interface SetupTotpResponse {
  secret: string;
  otpAuthUri: string;
}

/** POST /auth/mfa/totp/confirm (Bearer). Activa MFA y entrega 10 códigos de recuperación. */
export interface ConfirmTotpResponse {
  recoveryCodes: string[];
}

/** POST /auth/mfa/recovery-codes/regenerate (Bearer). */
export interface RegenerateRecoveryCodesResponse {
  recoveryCodes: string[];
}

export interface MfaMethodInfo {
  id: string;
  type: MfaMethodType;
  isConfirmed: boolean;
  isPreferred: boolean;
  maskedDestination: string | null;
  lastUsedAtUtc: string | null;
}

export interface TrustedDeviceInfo {
  id: string;
  userAgent: string | null;
  createdAtUtc: string;
  expiresAtUtc: string;
}

/** GET /auth/mfa/status (Bearer). */
export interface MfaStatusResponse {
  mfaEnabled: boolean;
  methods: MfaMethodInfo[];
  recoveryCodesRemaining: number;
  trustedDevices: TrustedDeviceInfo[];
}

/** Reto MFA pendiente entre el paso 1 (login) y el paso 2 (verify). */
export interface PendingMfa {
  loginTicket: string;
  methods: MfaMethodType[];
  /** Epoch ms en que expira el ticket (para la cuenta atrás). */
  expiresAt: number;
}
