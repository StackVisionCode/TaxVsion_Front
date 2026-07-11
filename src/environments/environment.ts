import { Environment } from './environment.model';

// Gateway YARP del backend TaxVision en desarrollo (ver TaxVsion_BackEnd/src/Gateway).
export const environment: Environment = {
  production: false,
  apiUrl: 'http://localhost:5047',
  // TODO: reemplazar por el GUID real del tenant sembrado en el backend (seed/migraciones).
  //       En modo mock (authMock: true) este valor no se valida.
  tenantId: '00000000-0000-0000-0000-000000000000',
  // authMock: true permite entrar sin backend (login sintético). Poner en false cuando
  // el backend esté levantado en apiUrl para ejercitar la integración real.
  authMock: true,
};
