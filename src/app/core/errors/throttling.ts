import { HttpErrorResponse } from '@angular/common/http';

/**
 * Rechazos "espera y reintenta" del backend: el rate limit (429 `RateLimit.Exceeded`, o el 429 vacío
 * de algún limiter viejo) y el load shedding del Gateway (503 `LoadShedding.Active`). Ninguno es un
 * error de datos del usuario: lo que corresponde es decirle cuánto esperar.
 *
 * Los throttles de dominio (login bloqueado, OTP, PIN de firma…) también son 429 pero traen su propio
 * código y mensaje de negocio, que la pantalla de ese flujo ya muestra — no se tratan acá.
 */
export const RATE_LIMIT_CODE = 'RateLimit.Exceeded';
export const LOAD_SHEDDING_CODE = 'LoadShedding.Active';

export type ThrottleKind = 'rate-limited' | 'overloaded';

export interface Throttle {
  readonly kind: ThrottleKind;
  /** Segundos a esperar según el backend; null si no lo informó. */
  readonly retryAfterSeconds: number | null;
}

/** Texto estable (sin cuenta regresiva) para mostrar inline o en un toast de pantalla. */
export const RATE_LIMITED_MESSAGE = "You're making requests too quickly. Please wait a moment and try again.";
export const OVERLOADED_MESSAGE = "We're receiving an unusually high number of requests. Please try again in a moment.";

/** El mensaje del socket cuando se envían mensajes/eventos demasiado rápido. */
export const SOCKET_RATE_LIMITED_MESSAGE = "You're sending messages too quickly. Please wait a moment and try again.";
export const CALLS_RATE_LIMITED_MESSAGE = "You're starting calls too quickly. Please wait a moment and try again.";

export function readThrottle(err: unknown): Throttle | null {
  if (!(err instanceof HttpErrorResponse)) {
    return null;
  }
  const code = bodyCode(err.error);
  if (err.status === 429 && (code === null || code === RATE_LIMIT_CODE)) {
    return { kind: 'rate-limited', retryAfterSeconds: retryAfterSeconds(err) };
  }
  if (err.status === 503 && (code === null || code === LOAD_SHEDDING_CODE)) {
    return { kind: 'overloaded', retryAfterSeconds: retryAfterSeconds(err) };
  }
  return null;
}

/** Mensaje sin número: lo que queda escrito en un campo de error no debe envejecer. */
export function throttleMessage(throttle: Throttle): string {
  return throttle.kind === 'overloaded' ? OVERLOADED_MESSAGE : RATE_LIMITED_MESSAGE;
}

/** Mensaje con la espera, para el aviso global (se regenera cada segundo mientras cuenta). */
export function throttleCountdownMessage(kind: ThrottleKind, secondsLeft: number): string {
  const wait = formatWait(secondsLeft);
  return kind === 'overloaded'
    ? `We're receiving an unusually high number of requests. Please try again in ${wait}.`
    : `You're making requests too quickly. Please try again in ${wait}.`;
}

/** "1 second", "45 seconds", "3 minutes", "2 hours" — algunas políticas cuentan por hora. */
export function formatWait(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) {
    return s === 1 ? '1 second' : `${s} seconds`;
  }
  const minutes = Math.ceil(s / 60);
  if (minutes < 60) {
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

/** Los acks de socket rechazados por rate limit (Chat.RateLimited, Call.RateLimited, Meeting.Chat.RateLimited). */
export function isSocketRateLimited(code: string | null | undefined): boolean {
  return !!code && code.endsWith('.RateLimited');
}

/** `code` que los servicios de socket adjuntan al Error de un ack rechazado (ver emitOrThrow). */
export function socketErrorCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * Cualquier 429 (también los throttles de dominio) o load shedding. Un reintento automático contra esto
 * solo gasta más cupo: los `retry` ad-hoc deben cortar acá.
 */
export function isThrottled(err: unknown): boolean {
  return (err instanceof HttpErrorResponse && err.status === 429) || readThrottle(err) !== null;
}

/** El texto de throttling si el error es un rate limit/load shedding; si no, el `fallback` de la pantalla. */
export function throttleMessageOr(err: unknown, fallback: string): string {
  const throttle = readThrottle(err);
  return throttle ? throttleMessage(throttle) : fallback;
}

function bodyCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') {
    return body.code;
  }
  if (typeof body === 'string' && body.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(body) as { code?: unknown };
      return typeof parsed.code === 'string' ? parsed.code : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** `retryAfterSeconds` del body (contrato del backend) o, si no está, el header `Retry-After`. */
function retryAfterSeconds(err: HttpErrorResponse): number | null {
  const body = err.error as { retryAfterSeconds?: unknown } | null;
  if (body && typeof body === 'object' && typeof body.retryAfterSeconds === 'number' && body.retryAfterSeconds > 0) {
    return Math.ceil(body.retryAfterSeconds);
  }
  const header = err.headers?.get('Retry-After');
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds);
  }
  const date = Date.parse(header);
  if (Number.isNaN(date)) {
    return null;
  }
  const fromDate = Math.ceil((date - Date.now()) / 1000);
  return fromDate > 0 ? fromDate : null;
}
