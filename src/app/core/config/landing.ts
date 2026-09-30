import { CanActivateFn } from '@angular/router';
import { environment } from '@env/environment';

/** URL absoluta del sitio público (Landing), donde viven el alta y la gestión de la suscripción. */
export function landingUrl(pathAndQuery: string): string {
  const base = environment.landingUrl.trim().replace(/\/+$/, '');
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  return `${base}${path}`;
}

/**
 * Enlaces viejos del alta en el CRM (`/register*`: correo post-pago, referidos compartidos): se
 * reenvían al Landing con la misma ruta y query. Es otro origen, así que sale con `location.replace`
 * (sin dejar la URL del CRM en el historial).
 */
export const redirectToLandingGuard: CanActivateFn = (_route, state) => {
  window.location.replace(landingUrl(state.url));
  return false;
};
