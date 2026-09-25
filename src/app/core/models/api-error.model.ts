import { HttpErrorResponse } from '@angular/common/http';
import { readThrottle, throttleMessage } from '@core/errors/throttling';

/**
 * Forma plana de error del backend (BuildingBlocks.Results.Error), serializada en
 * camelCase: `{ "code": "Auth.Invalid", "message": "Invalid credentials." }`.
 */
export interface ApiError {
  code: string;
  message: string;
}

/** RFC-7807 ProblemDetails: solo aparece en 500 / ConflictException (409). */
export interface ProblemDetails {
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  correlationId?: string;
}

/** Código sintético para fallos de red / backend inalcanzable (status 0). */
export const NETWORK_ERROR_CODE = 'Network.Unreachable';

/**
 * Fallback SEGURO cuando el backend no manda un `message` propio. Nunca usamos
 * `err.message` de Angular como texto de usuario: incluye la URL del API
 * (`"Http failure response for http://…: 500"`), lo que filtraría rutas
 * internas y GUIDs. Para el texto final de UI usar `toUserMessage`.
 */
const SAFE_FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

/** 503 sin mensaje propio (servicio caído, denylist de sesión): transitorio, no es culpa del usuario. */
export const SERVICE_UNAVAILABLE_MESSAGE = 'The service is temporarily unavailable. Please try again in a moment.';

/**
 * Normaliza cualquier error HTTP a un `ApiError` con `code` + `message`.
 * Cubre el `Error` plano, `ProblemDetails` y el fallo de conexión (status 0).
 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof HttpErrorResponse) {
    // status 0 => no hubo respuesta (backend caído, CORS o sin red).
    if (err.status === 0) {
      return { code: NETWORK_ERROR_CODE, message: SAFE_FALLBACK_MESSAGE };
    }
    // Rate limit / load shedding: el texto del backend era técnico ("user rate limit exceeded…",
    // "Fleet is overloaded…") y más de 200 pantallas muestran este `message` tal cual.
    const throttle = readThrottle(err);
    if (throttle) {
      const code = (err.error as { code?: string } | null)?.code ?? `Http.${err.status}`;
      return { code, message: throttleMessage(throttle) };
    }
    const body = err.error as (Partial<ApiError & ProblemDetails> & { error?: string; type?: string }) | string | null;
    if (body && typeof body === 'object') {
      // Algunos endpoints (Gateway TenantHostGuard, Signature host-guard) usan la clave `error`
      // en vez de `code` para el discriminador — ej. { error: "tenant_host_mismatch", message }.
      // Otros (SessionDenylistMiddleware) lo mandan en `type`. Solo confiamos en el texto que manda
      // NUESTRO backend (message/detail/title); nunca caemos a `err.message`, que trae la URL del API.
      const code = body.code ?? body.error ?? errorCodeFromType(body.type) ?? `Http.${err.status}`;
      if (err.status === 503 && !body.message) {
        return { code, message: SERVICE_UNAVAILABLE_MESSAGE };
      }
      return {
        code,
        message: body.message ?? body.detail ?? body.title ?? SAFE_FALLBACK_MESSAGE,
      };
    }
    // Con `responseType: 'text'` Angular NO parsea el cuerpo, así que un error del
    // backend llega como la cadena JSON entera. Sin esto se le mostraba al usuario el
    // literal `{"code":"...","message":"..."}` (pasaba en el modal de términos del alta).
    if (typeof body === 'string' && body) {
      const parsed = parseJsonError(body);
      // Si NO es nuestro JSON de error, no mostramos el cuerpo crudo (podría traer detalle
      // técnico); devolvemos el código HTTP y un genérico seguro.
      return parsed ?? { code: `Http.${err.status}`, message: SAFE_FALLBACK_MESSAGE };
    }
    return {
      code: `Http.${err.status}`,
      message: err.status === 503 ? SERVICE_UNAVAILABLE_MESSAGE : SAFE_FALLBACK_MESSAGE,
    };
  }
  return { code: 'Unknown', message: SAFE_FALLBACK_MESSAGE };
}

/** `type` como código solo si es uno nuestro (`Auth.X`), no la URL de un ProblemDetails de ASP.NET. */
function errorCodeFromType(type: unknown): string | null {
  return typeof type === 'string' && /^[A-Za-z]+(\.[A-Za-z0-9]+)+$/.test(type) ? type : null;
}

/** `{"code":"...","message":"..."}` servido como texto plano → ApiError; null si no lo es. */
function parseJsonError(raw: string): ApiError | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Partial<ApiError & ProblemDetails> & { error?: string };
    const message = parsed.message ?? parsed.detail ?? parsed.title;
    return parsed.code || parsed.error || message
      ? { code: parsed.code ?? parsed.error ?? 'Unknown', message: message ?? 'Error desconocido.' }
      : null;
  } catch {
    return null;
  }
}
