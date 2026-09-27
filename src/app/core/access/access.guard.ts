import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateChildFn,
  CanMatchFn,
  Route,
  Router,
  UrlSegment,
  UrlTree,
} from '@angular/router';
import { TokenService } from '@core/auth/token.service';
import { AccessStore } from './access.store';
import { featureById } from './features';

/**
 * B4 — el guard de acceso. Una URL escrita a mano nunca debe pintar una pantalla que el usuario no
 * puede usar: hasta ahora `/campaigns` entraba y mostraba listas vacías y errores sueltos, que es
 * el caso 7 del Anexo C.
 *
 * Va en dos formas porque resuelven cosas distintas:
 * - `accessCanMatch` corre al EMPAREJAR la ruta, así que el chunk perezoso ni se descarga.
 * - `accessCanActivateChild` cubre las hijas de una feature ya cargada (`/clients/:id`), donde el
 *   emparejamiento del padre ya ocurrió.
 *
 * Y no decide solo: **espera el bootstrap**. Sin esa espera, una recarga dura evalúa la ruta
 * mientras `/auth/me/access` todavía viaja, con cero permisos en mano, y manda a `/forbidden` a
 * alguien que sí tenía acceso.
 *
 * Sigue sin ser la barrera: el backend autoriza igual. Esto solo evita pintar una pantalla muerta.
 */
export const accessCanMatch: CanMatchFn = (route: Route, segments: UrlSegment[]) =>
  decide(featureIdOf(route.data), '/' + segments.map(segment => segment.path).join('/'));

export const accessCanActivateChild: CanActivateChildFn = (route: ActivatedRouteSnapshot, state) =>
  decide(featureIdOf(route.data), state.url);

function featureIdOf(data: Record<string, unknown> | undefined): string | undefined {
  const feature = data?.['feature'];
  return typeof feature === 'string' ? feature : undefined;
}

/**
 * `inject()` se llama ANTES del primer `await` a propósito: después de suspender, la función ya no
 * corre dentro del contexto de inyección del guard.
 */
async function decide(featureId: string | undefined, attemptedUrl: string): Promise<boolean | UrlTree> {
  const tokens = inject(TokenService);
  const access = inject(AccessStore);
  const router = inject(Router);

  // Una ruta sin feature declarada no se gatea: las páginas de aviso de esta misma fase, y
  // cualquier pantalla transversal, tienen que poder abrirse siempre.
  if (!featureId) {
    return true;
  }

  // Sin sesión no es una cuestión de permisos: manda el `authGuard`, que lleva al login con
  // returnUrl. Contestar acá dejaría al usuario en `/forbidden` en vez de poder iniciar sesión.
  if (!tokens.isAuthenticated()) {
    return true;
  }

  await access.ready();

  const feature = featureById(featureId);
  if (!feature) {
    return true;
  }

  const state = access.stateOf(feature);
  if (state.available) {
    return true;
  }

  // La razón decide la pantalla: el plan lleva a una comercial y el permiso a una donde lo que
  // corresponde es hablar con el administrador de la oficina.
  return router.createUrlTree([state.reason === 'plan' ? '/not-available' : '/forbidden'], {
    queryParams: { feature: feature.id, from: attemptedUrl },
  });
}
