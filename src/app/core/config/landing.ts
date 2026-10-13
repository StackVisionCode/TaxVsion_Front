import { CanActivateFn } from '@angular/router';
import { environment } from '@env/environment';
import { platformConfig } from './platform-config';

/**
 * URL absoluta del sitio público (Landing), donde viven el alta y la gestión de la suscripción. En prod
 * sale del dominio vigente de la plataforma; en dev, del environment (otro puerto local).
 */
export function landingUrl(pathAndQuery: string): string {
  const configured = environment.production ? `https://www.${platformConfig().baseDomain}` : environment.landingUrl;
  const base = configured.trim().replace(/\/+$/, '');
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
