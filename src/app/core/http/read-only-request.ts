import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * Marca un POST que solo lee (p. ej. POST /customers/search, que lleva el término en el cuerpo para
 * no dejarlo en la URL): el errorInterceptor le da el mismo reintento silencioso que a un GET.
 */
export const READ_ONLY_REQUEST = new HttpContextToken<boolean>(() => false);

/** Contexto listo para pasar en `{ context }` de un POST de solo lectura. */
export function readOnlyRequestContext(): HttpContext {
  return new HttpContext().set(READ_ONLY_REQUEST, true);
}
