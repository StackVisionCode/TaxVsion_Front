import { inject } from '@angular/core';
import { CanActivateChildFn, Router, UrlTree } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { SeatSlotGatedStore } from './seat-slot-gated.store';

/** Rutas exentas G-C2: hay que poder refrescar `/auth/me`, el bootstrap, y poder cerrar sesión. */
const EXEMPT_PREFIXES: readonly string[] = ['/blocked/', '/logout', '/login', '/auth/'];

/**
 * SG-8 — bloquea toda navegación mientras el user actual está "gated" (su asiento add-on está
 * suspendido por falta de pago y queda por encima del cap efectivo).
 *
 * No decide por su cuenta: solo lee el estado que setea `seatSlotGatedInterceptor` cuando el
 * backend devuelve `403 seats.user_slot_gated`. Si no hay bloqueo, pasa.
 *
 * - G-C2: nunca gatea `/blocked/*`, `/logout`, `/login`, `/auth/*` (login/me/me/access).
 * - G-C4: el owner **no** entra al desvío. El admin que ve a OTRO empleado gated no se afecta a
 *   sí mismo — su propio request no es el que trae el 403.
 */
export const seatSlotGatedCanActivateChild: CanActivateChildFn = (_route, state): boolean | UrlTree => {
  const router = inject(Router);
  const gated = inject(SeatSlotGatedStore);
  const access = inject(AccessStore);

  if (!gated.isGated()) {
    return true;
  }
  // G-C4: owner (TenantAdmin/PlatformAdmin) jamás se bloquea — el calculator del backend tampoco
  // debería meterlo en el gate, pero este cinturón barato cuida el caso raro de un cálculo stale.
  if (access.isAdmin()) {
    return true;
  }
  const url = state.url ?? '/';
  if (EXEMPT_PREFIXES.some(prefix => url === prefix.replace(/\/$/, '') || url.startsWith(prefix))) {
    return true;
  }
  return router.createUrlTree(['/blocked/seat-suspended']);
};
