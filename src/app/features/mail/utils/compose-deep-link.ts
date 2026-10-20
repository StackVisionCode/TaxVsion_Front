import type { ParamMap } from '@angular/router';

/** `/email?compose=1&customerId=<id>&to=<email>` (lo arma el perfil del cliente). */
export interface ComposeMailDeepLink {
  customerId: string;
  /** Destinatario a precargar en "To"; null = el composer abre vacío. */
  to: string | null;
}

/** Null si la URL no pide redactar a un cliente. */
export function parseComposeMailDeepLink(params: ParamMap): ComposeMailDeepLink | null {
  if (params.get('compose') !== '1') {
    return null;
  }
  const customerId = params.get('customerId')?.trim();
  if (!customerId) {
    return null;
  }
  return { customerId, to: params.get('to')?.trim() || null };
}

/** True si hay algo del deep link en la URL (se limpia aunque no sea válido).
 * Importante: cuando viene `threadId`/`messageId`/`accountId` la URL pertenece
 * al deep link de notificación (abrir hilo), no al compose; devolvemos false
 * para no borrar esos params antes de que el deep link de notificación los lea. */
export function hasComposeMailParams(params: ParamMap): boolean {
  if (params.has('threadId') || params.has('messageId') || params.has('accountId')) {
    return false;
  }
  return params.has('compose') || params.has('to');
}
