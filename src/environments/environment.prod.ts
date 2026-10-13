import { Environment } from './environment.model';

// En producción NO hay una apiUrl fija: cada tenant vive en https://<slug>.taxoffix.io
// y el backend (Auth) resuelve el tenant leyendo el Host de la request
// (TenantHostResolutionMiddleware). ApiConfigService arma esa URL a partir del slug
// resuelto + baseDomain. Los endpoints del sistema (signup, check-availability,
// tenant-resolution) van a systemHost, que no resuelve a ningún tenant.
export const environment: Environment = {
  production: true,
  apiUrl: '', // sin uso en prod — la base se calcula por tenant en ApiConfigService
  systemHost: 'api.taxoffix.io',
  baseDomain: 'taxoffix.io',
  brandName: 'TaxOffix',
  useHostResolution: true,
  // No se usa en prod: el tenant lo resuelve el Host, no el body de login.
  tenantId: '',
  authMock: false,
  // Alta y gestión de la suscripción viven en el sitio público.
  landingUrl: 'https://www.taxoffix.io',
  signatureAutosaveEnabled: false,
};
