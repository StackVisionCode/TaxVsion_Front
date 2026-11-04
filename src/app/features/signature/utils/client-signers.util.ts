import {
  EditorSigner,
  PlacedField,
  WizardClient,
} from '../ui/signature-request-panel/signature-wizard.model';
import { reassignSignerFields } from './editor-fields.util';

/**
 * Firmantes cliente del editor: un cliente registrado de la solicitud firma con el id local
 * `client:<customerId>`. Ese prefijo es lo que distingue a un cliente de un firmante externo en el
 * wizard (el backend vincula el cliente por email al agregar el firmante).
 */
const CLIENT_SIGNER_PREFIX = 'client:';

export function clientSignerId(clientId: string): string {
  return `${CLIENT_SIGNER_PREFIX}${clientId}`;
}

export function isClientSignerId(signerId: string): boolean {
  return signerId.startsWith(CLIENT_SIGNER_PREFIX);
}

export interface ClientSignerSync<T extends PlacedField> {
  signers: EditorSigner[];
  fields: T[];
  /** id viejo → id nuevo de los firmantes reemplazados en su sitio (para mover el firmante activo). */
  replaced: Record<string, string>;
  changed: boolean;
}

/**
 * Alinea los firmantes cliente con los clientes de la solicitud:
 * - los que siguen se respetan tal cual (canal, teléfono e idioma elegidos);
 * - si salen y entran los mismos que había (p. ej. "Change" en el paso 1), cada uno se reemplaza en su
 *   sitio por orden: conserva color, posición en el orden de firma y sus campos;
 * - los que sobran se quitan con sus campos y los nuevos se agregan detrás del último firmante cliente.
 */
export function syncClientSigners<T extends PlacedField>(
  signers: EditorSigner[],
  fields: T[],
  clients: WizardClient[],
  toSigner: (client: WizardClient, color: string | null) => EditorSigner,
  newFieldId: () => string,
): ClientSignerSync<T> {
  const wanted = new Set(clients.map((client) => clientSignerId(client.id)));
  const present = new Set(signers.map((signer) => signer.id));
  const leaving = signers.filter((signer) => isClientSignerId(signer.id) && !wanted.has(signer.id));
  const arriving = clients.filter((client) => !present.has(clientSignerId(client.id)));
  if (leaving.length === 0 && arriving.length === 0) {
    return { signers, fields, replaced: {}, changed: false };
  }

  let nextSigners = [...signers];
  let nextFields = fields;
  const replaced: Record<string, string> = {};

  if (leaving.length === arriving.length) {
    leaving.forEach((old, index) => {
      const next = toSigner(arriving[index], old.color);
      nextSigners = nextSigners.map((signer) => (signer.id === old.id ? next : signer));
      nextFields = reassignSignerFields(nextFields, old.id, next.id, newFieldId);
      replaced[old.id] = next.id;
    });
    return { signers: nextSigners, fields: nextFields, replaced, changed: true };
  }

  const leavingIds = new Set(leaving.map((signer) => signer.id));
  nextSigners = nextSigners.filter((signer) => !leavingIds.has(signer.id));
  nextFields = nextFields.filter((field) => !leavingIds.has(field.signerId));
  const insertAt =
    nextSigners.reduce((last, signer, index) => (isClientSignerId(signer.id) ? index : last), -1) + 1;
  nextSigners.splice(insertAt, 0, ...arriving.map((client) => toSigner(client, null)));
  return { signers: nextSigners, fields: nextFields, replaced, changed: true };
}
