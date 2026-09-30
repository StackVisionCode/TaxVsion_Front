import { AccessRequirement } from '@core/access/features';

/**
 * Deep links del "workspace" del cliente hacia otras features. Clients NO importa esas features:
 * navega por URL con query params que la página destino consume (contrato acordado con cada una).
 *
 * - Firma:    /signature?new=1&customerId=&customerName=   (abre el wizard con el cliente precargado)
 * - Reunión:  /meetings?schedule=1&customerId=&customerName=
 * - Correo:   /email?compose=1&to=&customerId=             (la feature Mail vive en la ruta `email`, no `mail`)
 */
export interface WorkspaceLink {
  commands: string[];
  queryParams: Record<string, string>;
}

export function newSignatureRequestLink(customerId: string, customerName: string): WorkspaceLink {
  return { commands: ['/signature'], queryParams: { new: '1', customerId, customerName } };
}

export function scheduleMeetingLink(customerId: string, customerName: string): WorkspaceLink {
  return { commands: ['/meetings'], queryParams: { schedule: '1', customerId, customerName } };
}

export function composeEmailLink(customerId: string, email: string): WorkspaceLink {
  const queryParams: Record<string, string> = { compose: '1', customerId };
  if (email.trim()) {
    queryParams['to'] = email.trim();
  }
  return { commands: ['/email'], queryParams };
}

/**
 * Qué exige cada acción, en el formato de `AccessStore.canUse` (módulo del plan + permiso). Se
 * pide el permiso de la ACCIÓN (crear/enviar), no solo el de ver la feature.
 */
export const WORKSPACE_ACCESS = {
  signature: { module: 'signatures', anyOf: ['signature.request.create'] },
  signatureRead: { module: 'signatures', anyOf: ['signature.request.read'] },
  meeting: { module: 'meetings', anyOf: ['communication.meeting.create'] },
  email: { module: 'email', anyOf: ['correspondence.compose', 'correspondence.send'] },
  // SMS no es un módulo del plan (se cobra por consumo): solo el permiso de envío.
  sms: { module: null, anyOf: ['sms.send'] },
  billing: { module: null, anyOf: ['invoicing.view'] },
} satisfies Record<string, AccessRequirement>;
