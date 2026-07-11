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
    const body = err.error as Partial<ApiError & ProblemDetails> | string | null;
    if (body && typeof body === 'object') {
      return {
        code: body.code ?? `Http.${err.status}`,
        message: body.message ?? body.detail ?? body.title ?? err.message ?? 'Error desconocido.',
      };
    }
    return {
      code: `Http.${err.status}`,
      message: typeof body === 'string' && body ? body : err.message,
    };
  }
  return { code: 'Unknown', message: 'Error desconocido.' };
}
