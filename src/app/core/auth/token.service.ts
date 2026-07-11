import { Injectable, computed, signal } from '@angular/core';
import { AuthTokens } from './auth.model';

const ACCESS_KEY = 'tvf.auth.accessToken';
const REFRESH_KEY = 'tvf.auth.refreshToken';
const EXPIRES_KEY = 'tvf.auth.expiresAt';
const DEVICE_KEY = 'tvf.auth.deviceToken';

/**
 * Persistencia de la sesión (tokens) en localStorage + signals reactivos.
 * Mismo patrón defensivo que el dashboard store: todo acceso a localStorage va
 * envuelto en try/catch por si no está disponible (SSR / modo privacidad).
 */
@Injectable({ providedIn: 'root' })
export class TokenService {
  private readonly _accessToken = signal<string | null>(read(ACCESS_KEY));
  private readonly _expiresAt = signal<number | null>(readNumber(EXPIRES_KEY));

  /** Token de acceso actual (reactivo, para UI/interceptor). */
  readonly accessToken = this._accessToken.asReadonly();

  /** Hay un token presente (no evalúa expiración de forma reactiva). */
  readonly hasSession = computed(() => this._accessToken() !== null);

  /** Comprobación autoritativa y fresca: token presente y no expirado. Úsala en guards. */
  isAuthenticated(): boolean {
    const token = this._accessToken();
    if (!token) {
      return false;
    }
    const exp = this._expiresAt();
    return exp === null || Date.now() < exp;
  }

  setSession(tokens: AuthTokens): void {
    const expiresAt = Date.now() + tokens.expiresInSeconds * 1000;
    write(ACCESS_KEY, tokens.accessToken);
    write(REFRESH_KEY, tokens.refreshToken);
    write(EXPIRES_KEY, String(expiresAt));
    if (tokens.deviceToken) {
      // El deviceToken (trusted device) sobrevive al logout para saltar MFA la próxima vez.
      write(DEVICE_KEY, tokens.deviceToken);
    }
    this._accessToken.set(tokens.accessToken);
    this._expiresAt.set(expiresAt);
  }

  /** Limpia la sesión pero conserva el deviceToken. */
  clear(): void {
    remove(ACCESS_KEY);
    remove(REFRESH_KEY);
    remove(EXPIRES_KEY);
    this._accessToken.set(null);
    this._expiresAt.set(null);
  }

  getAccessToken(): string | null {
    return this._accessToken();
  }

  getRefreshToken(): string | null {
    return read(REFRESH_KEY);
  }

  getDeviceToken(): string | null {
    return read(DEVICE_KEY);
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readNumber(key: string): number | null {
  const raw = read(key);
  if (raw === null) {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sin persistencia disponible: la sesión vive solo en memoria.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // noop
  }
}
