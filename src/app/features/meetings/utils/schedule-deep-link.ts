import type { ParamMap } from '@angular/router';
import type { MeetingInviteeDraft } from '../data-access/meeting.model';

/** `/meetings?schedule=1&customerId=<id>&customerName=<name>` (lo arma el perfil del cliente). */
export interface ScheduleMeetingDeepLink {
  customerId: string;
  customerName: string | null;
}

/** Null si la URL no pide agendar con un cliente. */
export function parseScheduleMeetingDeepLink(params: ParamMap): ScheduleMeetingDeepLink | null {
  if (params.get('schedule') !== '1') {
    return null;
  }
  const customerId = params.get('customerId')?.trim();
  if (!customerId) {
    return null;
  }
  return { customerId, customerName: params.get('customerName')?.trim() || null };
}

/** True si hay algo del deep link en la URL (se limpia aunque no sea válido). */
export function hasScheduleMeetingParams(params: ParamMap): boolean {
  return params.has('schedule') || params.has('customerId') || params.has('customerName');
}

/**
 * El invitado `customer` que espera el panel (el backend resuelve su customerId a su usuario de
 * portal). El nombre y el email salen del directorio; si no se pudo leer, el nombre del link.
 */
export function customerInviteeDraft(
  link: ScheduleMeetingDeepLink,
  customer: { displayName: string; primaryEmail: string } | null,
): MeetingInviteeDraft {
  return {
    kind: 'customer',
    userId: null,
    customerId: link.customerId,
    email: customer?.primaryEmail || null,
    name: customer?.displayName || link.customerName || 'Client',
  };
}
