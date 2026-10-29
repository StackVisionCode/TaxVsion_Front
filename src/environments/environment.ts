import { Environment } from './environment.model';

// Gateway YARP del backend TaxPro Office en desarrollo (ver TaxVsion_BackEnd/src/Gateway).
export const environment: Environment = {
  production: false,
  apiUrl: 'http://localhost:5047',
  // En dev el gateway local atiende sistema y tenant por igual; systemHost/baseDomain
  // no se usan (ApiConfigService cae a apiUrl cuando production=false).
  systemHost: 'localhost:5047',
  baseDomain: 'localhost',
  brandName: 'TaxOffix',
  useHostResolution: false,
  // Tenant de plataforma sembrado en el backend (donde vive bootstrap-admin@taxvision.local).
  // Es el tenantId que se manda en /auth/login (con TenantDomains:EnforceHostResolution=false en dev).
  tenantId: '8F58A521-4C25-4D91-9F4E-7AD5DF14C001',
  // Integración real contra el gateway (apiUrl). En true usa login sintético sin backend.
  authMock: false,
  // Landing local (ng serve en el proyecto landing, puerto fijo 4201).
  landingUrl: 'http://localhost:4201',
  // DEV: correr el portal del cliente en este origen (ng serve --port 4300) para probar el
  // login central cliente end-to-end. En prod se ignora.
  portalDevUrl: 'http://localhost:4300',
  signatureAutosaveEnabled: true,
  firebase: {
    config: {
      apiKey: 'AIzaSyAF71h1RYTK7lflut3J7VHQiJ_LRgWKL9k',
      authDomain: 'taxproffice-8a46a.firebaseapp.com',
      projectId: 'taxproffice-8a46a',
      storageBucket: 'taxproffice-8a46a.firebasestorage.app',
      messagingSenderId: '724612976273',
      appId: '1:724612976273:web:73346447648f1b1cd2f930',
    },
    vapidKey:
      'BCUQGRcewtVXeeTAupuqVhB9S9_IV3ao0IQqHlg-b1hRKqknIk8IktmRG-z65MFgOCMP3R_jBdAmEnuG8fOnNSY',
  },
};
