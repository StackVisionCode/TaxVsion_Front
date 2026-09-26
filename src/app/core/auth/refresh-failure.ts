import { HttpErrorResponse } from '@angular/common/http';

/**
 * Solo un rechazo del propio refresh token (400/401/403, o no tener uno) cierra la sesión. Un 429, un
 * 503 o un corte de red al renovar son transitorios: la sesión sigue siendo válida y deslogueaba al
 * usuario sin motivo (el Gateway limitaba /auth/refresh a 10/min por IP, compartidos por toda la oficina).
 */
export function isRefreshRejected(err: unknown): boolean {
  if (!(err instanceof HttpErrorResponse)) {
    return true;
  }
  return err.status === 400 || err.status === 401 || err.status === 403;
}
