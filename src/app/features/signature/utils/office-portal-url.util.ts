/**
 * URL del portal del cliente de la oficina, a la que el firmante vuelve tras firmar (14.3).
 *
 * `PublicSignerView` NO trae slug, dominio ni URL de portal de la oficina, pero el enlace de firma se
 * sirve en el subdominio de la propia oficina (`<slug>.taxproffice.com`; el backend rechaza con
 * `tenant_host_mismatch` un token usado bajo el subdominio de otra oficina), así que el slug sale del
 * host. El portal vive en `https://<slug>.<baseDomain>/portal` (mismo patrón que el guard del CRM y la
 * aceptación de invitaciones). Sin slug (entrada general app.*, dev sin portalDevUrl) → `null` y la
 * pantalla final no ofrece redirección.
 */
export interface OfficePortalEnv {
  production: boolean;
  baseDomain: string;
  portalDevUrl?: string;
}

export function buildOfficePortalLoginUrl(slug: string | null | undefined, env: OfficePortalEnv): string | null {
  if (env.production) {
    const clean = (slug ?? '').trim().toLowerCase();
    // Un slug es una sola etiqueta DNS: nada de puntos, barras ni caracteres raros (evita open redirects).
    if (!clean || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(clean) || !env.baseDomain) {
      return null;
    }
    return `https://${clean}.${env.baseDomain}/portal/client/auth/login`;
  }
  const dev = env.portalDevUrl?.trim().replace(/\/+$/, '');
  return dev ? `${dev}/client/auth/login` : null;
}
