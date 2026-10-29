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
