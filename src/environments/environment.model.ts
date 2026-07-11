export interface Environment {
  production: boolean;
  /** URL base del gateway del backend (YARP). Todas las rutas cuelgan de aquí. */
  apiUrl: string;
  /** GUID del tenant a usar en el login (el formulario no lo pide). */
  tenantId: string;
  /**
   * Modo mock de auth: cuando es true, AuthService.login() no llama al backend y
   * devuelve una sesión sintética exitosa. Permite trabajar sin el backend arriba.
   */
  authMock: boolean;
}
