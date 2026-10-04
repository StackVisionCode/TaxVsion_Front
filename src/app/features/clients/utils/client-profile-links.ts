/**
 * Deep links del perfil de cliente hacia otros módulos. Una feature no importa a otra: se navega
 * por router con query params que la página destino lee una vez y luego limpia de la URL.
 *
 * Contratos (los lee cada página destino):
 *  - /signature?new=1&customerId=<id>&customerName=<name>   → wizard nuevo con el cliente elegido
 *  - /meetings?schedule=1&customerId=<id>&customerName=<name> → agendar con el cliente invitado
 *  - /email?compose=1&customerId=<id>&to=<email>            → redactar al cliente desde su bandeja
 */

export interface ClientLinkTarget {
  id: string;
  displayName: string;
  email: string;
}

export interface ClientDeepLink {
  commands: string[];
  queryParams: Record<string, string>;
}

export function signatureRequestLink(client: ClientLinkTarget): ClientDeepLink {
  return {
    commands: ['/signature'],
    queryParams: { new: '1', customerId: client.id, customerName: client.displayName },
  };
}

export function scheduleMeetingLink(client: ClientLinkTarget): ClientDeepLink {
  return {
    commands: ['/meetings'],
    queryParams: { schedule: '1', customerId: client.id, customerName: client.displayName },
  };
}

/** Sin email no se manda `to` vacío: el composer abre igual con el cliente elegido. */
export function composeEmailLink(client: ClientLinkTarget): ClientDeepLink {
  const queryParams: Record<string, string> = { compose: '1', customerId: client.id };
  const to = client.email?.trim();
  if (to) {
    queryParams['to'] = to;
  }
  return { commands: ['/email'], queryParams };
}
