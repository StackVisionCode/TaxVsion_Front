import { Environment } from './environment.model';

// Subdominio de la oficina (TaxPro Office — ver branding en sidebar/navbar y el
// dominio de correo mock @taxprooffice.com/.local). Este host TODAVÍA no existe
// en el backend de producción: alguien con acceso al Auth/Tenant de producción
// tiene que darlo de alta primero (POST /auth/subdomains/reserve + POST /tenants,
// ver TaxVsion_BackEnd README §33.3) antes de que este apiUrl responda algo.
export const environment: Environment = {
  production: true,
  apiUrl: 'https://api.taxprocore.com',
  // En producción el tenant se resuelve por el Host de la request (ver
  // TenantHostResolutionMiddleware en Auth.Api), no por este valor — el body
  // de login lo ignora siempre que EnforceHostResolution=true. Se deja vacío
  // a propósito.
  tenantId: '',
  authMock: false,
  // TODO: publishable key de Stripe de producción (pk_live_…).
  stripePublishableKey: '',
};
