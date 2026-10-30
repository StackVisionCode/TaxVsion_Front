import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * Marca una petición PÚBLICA (sin sesión): el `authInterceptor` no le adjunta el Bearer aunque haya
 * un token guardado en el navegador, y el `errorInterceptor` no intenta refresh ni manda al login
 * ante un 401. Para endpoints de token por enlace (p. ej. la página de invitado `/meet/:token`).
 */
export const ANONYMOUS_REQUEST = new HttpContextToken<boolean>(() => false);

/** Contexto listo para pasar en `{ context }` de una petición pública. */
export function anonymousRequestContext(): HttpContext {
  return new HttpContext().set(ANONYMOUS_REQUEST, true);
}
