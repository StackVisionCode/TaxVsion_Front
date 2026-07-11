import { Environment } from './environment.model';

// TODO: confirmar la URL real del gateway de producción antes de desplegar.
export const environment: Environment = {
  production: true,
  apiUrl: '',
  // TODO: en producción el tenant se resolverá por subdominio; placeholder por ahora.
  tenantId: '',
  authMock: false,
};
