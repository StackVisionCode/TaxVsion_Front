import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { SeatSlotGatedStore } from '@core/auth/seat-slot-gated.store';

/** El code que el backend adjunta al 403 cuando el asiento del usuario está bloqueado por slot gating. */
const SEAT_GATED_CODE = 'seats.user_slot_gated';
/** La pantalla de bloqueo (y las rutas de /logout) nunca redirigen a sí mismas: loop guard de G-C1. */
const BLOCKED_PREFIX = '/blocked/';
const LOGOUT_PREFIX = '/logout';

/**
 * SG-8 — intercepta `403 seats.user_slot_gated`.
 *
 * - Guarda el payload (`slotIndex`, `effectiveCap`, `contactAdminUrl`) en el `SeatSlotGatedStore`
 *   para que la pantalla de bloqueo lo lea sin un segundo round-trip.
 * - Navega a `/blocked/seat-suspended` SALVO que ya estemos ahí o en `/logout` (G-C1).
 * - Propaga el error: el consumer sigue viéndolo (no se "come" el 403).
 *
 * Va entre `authInterceptor` (que agrega el Bearer) y `errorInterceptor` (refresh/throttle),
 * así solo mira los 403 ya autenticados.
 */
export const seatSlotGatedInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const store = inject(SeatSlotGatedStore);

  return next(req).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 403) {
        return throwError(() => err);
      }
      const body = err.error as { error?: unknown } | null | undefined;
      if (!body || body.error !== SEAT_GATED_CODE) {
        return throwError(() => err);
      }
      const payload = toPayload(err.error);
      if (payload) {
        store.setGatedState(payload);
      }
      // G-C1: evitar bucle de redirección si ya estamos en la pantalla de bloqueo o cerrando sesión.
      const url = router.url ?? '/';
      if (!url.startsWith(BLOCKED_PREFIX) && !url.startsWith(LOGOUT_PREFIX)) {
        void router.navigate(['/blocked/seat-suspended']);
      }
      return throwError(() => err);
    }),
  );
};

interface SeatGatedBody {
  slotIndex?: unknown;
  effectiveCap?: unknown;
  contactAdminUrl?: unknown;
}

/** Lectura defensiva del payload: un backend viejo o parcial no debería tumbar la UI. */
function toPayload(body: unknown): { slotIndex: number; effectiveCap: number; contactAdminUrl: string } | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const { slotIndex, effectiveCap, contactAdminUrl } = body as SeatGatedBody;
  if (typeof slotIndex !== 'number' || typeof effectiveCap !== 'number') {
    return null;
  }
  return {
    slotIndex,
    effectiveCap,
    contactAdminUrl: typeof contactAdminUrl === 'string' ? contactAdminUrl : '',
  };
}
