import { HttpErrorResponse } from '@angular/common/http';

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
 * Normaliza cualquier error HTTP a un `ApiError` con `code` + `message`.
 * Cubre el `Error` plano, `ProblemDetails` y el fallo de conexión (status 0).
 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof HttpErrorResponse) {
    // status 0 => no hubo respuesta (backend caído, CORS o sin red).
    if (err.status === 0) {
      return { code: NETWORK_ERROR_CODE, message: 'No se pudo conectar con el servidor.' };
    }
    const body = err.error as (Partial<ApiError & ProblemDetails> & { error?: string }) | string | null;
    if (body && typeof body === 'object') {
      // Algunos endpoints (Gateway TenantHostGuard, Signature host-guard) usan la clave `error`
      // en vez de `code` para el discriminador — ej. { error: "tenant_host_mismatch", message }.
      return {
        code: body.code ?? body.error ?? `Http.${err.status}`,
        message: body.message ?? body.detail ?? body.title ?? err.message ?? 'Error desconocido.',
      };
    }
    // Con `responseType: 'text'` Angular NO parsea el cuerpo, así que un error del
    // backend llega como la cadena JSON entera. Sin esto se le mostraba al usuario el
    // literal `{"code":"...","message":"..."}` (pasaba en el modal de términos del alta).
    if (typeof body === 'string' && body) {
      const parsed = parseJsonError(body);
      return parsed ?? { code: `Http.${err.status}`, message: body };
    }
    return { code: `Http.${err.status}`, message: err.message };
  }
  return { code: 'Unknown', message: 'Error desconocido.' };
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
