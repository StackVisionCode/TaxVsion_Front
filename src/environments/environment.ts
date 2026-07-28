import { Environment } from './environment.model';

// Gateway YARP del backend TaxVision en desarrollo (ver TaxVsion_BackEnd/src/Gateway).
export const environment: Environment = {
  production: false,
  apiUrl: 'http://localhost:5047',
  // Tenant de plataforma sembrado en el backend (donde vive bootstrap-admin@taxvision.local).
  // Es el tenantId que se manda en /auth/login (con TenantDomains:EnforceHostResolution=false en dev).
  tenantId: '8F58A521-4C25-4D91-9F4E-7AD5DF14C001',
  // Integración real contra el gateway (apiUrl). En true usa login sintético sin backend.
  authMock: false,
  // Publishable key de test de Stripe (pk_test_…). Pegar la tuya para habilitar el Payment Element.
  stripePublishableKey: 'pk_test_51TtSTdLvROnZXfgSkw87Y3DrHxOdy6xrF6u3qJCuak1GlegLkg1odx4EzjsmeIYvOHmzSLJDnBXyvDX4DiUmnWmE003Uid8pfg',
};
