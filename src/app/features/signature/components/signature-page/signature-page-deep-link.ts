import type { ParamMap } from '@angular/router';

/** `/signature?new=1&customerId=<id>&customerName=<name>` (lo arma el perfil del cliente). */
export interface NewSignatureDeepLink {
  customerId: string;
  /** Solo de respaldo para mensajes: el cliente real se lee del directorio por id. */
  customerName: string | null;
}

/** Null si la URL no pide abrir el wizard con un cliente. */
export function parseNewSignatureDeepLink(params: ParamMap): NewSignatureDeepLink | null {
  if (params.get('new') !== '1') {
    return null;
  }
  const customerId = params.get('customerId')?.trim();
  if (!customerId) {
    return null;
  }
  return { customerId, customerName: params.get('customerName')?.trim() || null };
}

/** True si la URL trae alguno de los params del deep link (para limpiarlos aunque no sea válido). */
export function hasNewSignatureParams(params: ParamMap): boolean {
  return params.has('new') || params.has('customerId') || params.has('customerName');
}
