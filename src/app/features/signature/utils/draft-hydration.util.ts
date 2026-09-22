import { SignatureCategory, SignatureFieldKind, SignatureRequestDetail } from '../data-access/signature.model';
import type { WizardSendState } from '../data-access/signature.store';
import {
  EditorSeed,
  EditorSeedField,
  EditorSigner,
  RequestRules,
  WizardClient,
} from '../ui/signature-request-panel/signature-wizard.model';
import { FieldType } from '../ui/signature-request-panel/signature-wizard.model';
import { avatarColor, defaultRules } from '../ui/signature-request-panel/signature-wizard.presenter';

/** El backend usa Checkbox, que el editor no modela: se degrada a texto. */
export function kindToFieldType(kind: SignatureFieldKind): FieldType {
  switch (kind) {
    case 'Signature':
      return 'signature';
    case 'Initials':
      return 'initials';
    case 'Date':
      return 'date';
    default:
      return 'text'; // Text y Checkbox
  }
}

/** Un campo original tal como está en el backend (para el diff al guardar/enviar). */
export interface OriginalField {
  editorLocalId: string;
  fieldId: string;
  signerBackendId: string;
}

export interface DraftHydration {
  client: WizardClient;
  seed: EditorSeed;
  /** Estado de envío pre-poblado: el commit NO re-crea/re-agrega lo ya existente. */
  sendState: WizardSendState;
  original: {
    signerBackendIds: string[];
    fields: OriginalField[];
  };
  metadata: {
    title: string;
    description: string;
    category: SignatureCategory;
    /** YYYY-MM-DD derivada de expiresAtUtc (para el input de fecha). */
    dueDate: string;
  };
}

/**
 * Traduce un borrador del backend a todo lo que el wizard necesita para reabrirlo y editarlo:
 * el cliente, la siembra del editor (firmantes + campos normalizados), el `sendState` que evita
 * duplicar lo ya creado, y los ids originales para calcular el diff al guardar/enviar.
 *
 * El firmante "cliente" es el que tiene `mappedCustomerId` (o el primero por orden); su localId es
 * `client:<id>` para que el editor lo trate como obligatorio. Los demás usan `seed-<backendId>`.
 * Ojo: SignerResponse no trae canal/teléfono/idioma, así que se muestran por defecto; como el commit
 * no re-agrega firmantes existentes, sus valores reales en el backend se conservan.
 */
export function buildDraftHydration(detail: SignatureRequestDetail): DraftHydration {
  const signers = [...detail.signers].sort((a, b) => a.order - b.order);
  const clientSigner = signers.find(s => s.mappedCustomerId !== null) ?? signers[0] ?? null;
  const clientId = clientSigner?.mappedCustomerId ?? `draft:${detail.id}`;
  const clientLocalId = `client:${clientId}`;

  const localIdOf = (signerId: string): string =>
    clientSigner && signerId === clientSigner.id ? clientLocalId : `seed-${signerId}`;

  const client: WizardClient = {
    id: clientId,
    displayName: clientSigner?.fullName ?? 'Client',
    email: clientSigner?.email ?? '',
    phone: '',
    type: 'individual',
    isActive: true,
    createdAt: '',
  };

  const editorSigners: EditorSigner[] = signers.map((signer, index) => ({
    id: localIdOf(signer.id),
    name: signer.fullName,
    email: signer.email,
    color: avatarColor(index),
    channel: 'email',
    phone: '',
    language: 'En',
  }));

  const seedFields: EditorSeedField[] = [];
  const originalFields: OriginalField[] = [];
  const postedFieldLocalIds: string[] = [];
  const signerIdByLocal: Record<string, string> = {};

  for (const signer of signers) {
    signerIdByLocal[localIdOf(signer.id)] = signer.id;
    for (const field of signer.fields) {
      const localId = `seed-${field.id}`;
      seedFields.push({
        localId,
        type: kindToFieldType(field.kind),
        page: field.page,
        nx: field.x,
        ny: field.y,
        nw: field.width,
        nh: field.height,
        signerLocalId: localIdOf(signer.id),
        label: field.label ?? undefined,
      });
      postedFieldLocalIds.push(localId);
      originalFields.push({ editorLocalId: localId, fieldId: field.id, signerBackendId: signer.id });
    }
  }

  const rules: RequestRules = {
    ...defaultRules(),
    sequential: detail.requiresSequentialSigning,
    certificate: detail.generateCertificate,
    sendSignedDocument: detail.sendSignedDocumentToSigners,
    sendCertificate: detail.sendCertificateToSigners,
    autoReminder: detail.autoRemindersEnabled,
    reminderIntervalHours: detail.reminderIntervalHours,
  };

  return {
    client,
    seed: { signers: editorSigners, fields: seedFields, rules },
    sendState: {
      requestId: detail.id,
      signerIdByLocal,
      postedFieldLocalIds,
      pinSet: detail.requiresPractitionerPin,
      sent: false,
    },
    original: {
      signerBackendIds: signers.map(s => s.id),
      fields: originalFields,
    },
    metadata: {
      title: detail.title,
      description: detail.description ?? '',
      category: detail.category,
      dueDate: detail.expiresAtUtc ? detail.expiresAtUtc.slice(0, 10) : '',
    },
  };
}
