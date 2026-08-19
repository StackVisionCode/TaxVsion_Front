export interface Environment {
  production: boolean;
  /**
   * DEV: URL única del gateway YARP (http://localhost:5047) — en dev todo (sistema y
   * tenant) cuelga de aquí porque EnforceHostResolution=false. En PROD queda vacío:
   * la URL se arma por tenant en ApiConfigService a partir de systemHost/baseDomain.
   */
  apiUrl: string;
  /** Host de los endpoints DEL SISTEMA (sin tenant): api.taxproffice.com en prod. */
  systemHost: string;
  /** Dominio base para componer el subdominio del tenant: <slug>.{baseDomain}. */
  baseDomain: string;
  /**
   * true en prod: el backend resuelve el tenant por el Host de la request, así que
   * el front debe pegarle a https://<slug>.baseDomain y NO mandar tenantId en el body.
   * false en dev: se manda tenantId en el body y todo va al gateway local.
   */
  useHostResolution: boolean;
  /** GUID del tenant para el body de login SOLO en dev (useHostResolution=false). */
  tenantId: string;
  /**
   * Modo mock de auth: cuando es true, AuthService.login() no llama al backend y
   * devuelve una sesión sintética exitosa. Permite trabajar sin el backend arriba.
   */
  authMock: boolean;
  /** Publishable key de Stripe (pk_test_… en dev). Es pública por diseño; la usa el Payment
   *  Element del checkout. Vacía = el checkout cae a las tarjetas de prueba mapeadas. */
  stripePublishableKey: string;
}
