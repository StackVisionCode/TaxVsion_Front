import {
  SignatureCategory,
  SignatureFieldKind,
  SignatureRequestDetail,
} from '../data-access/signature.model';
import type { WizardSendState } from '../data-access/signature.store';
import {
  EditorSeed,
  EditorSeedField,
  EditorSigner,
  PREPARER_PARTY_ID,
  RequestRules,
  WizardClient,
} from '../ui/signature-request-panel/signature-wizard.model';
import { FieldType } from '../ui/signature-request-panel/signature-wizard.model';
import {
  avatarColor,
  defaultRules,
} from '../ui/signature-request-panel/signature-wizard.presenter';
import { clientSignerId } from './client-signers.util';

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

export interface DraftHydration {
  /** Clientes de la solicitud (firmantes vinculados a un cliente), en el orden de firma. */
  clients: WizardClient[];
  seed: EditorSeed;
  /** Estado de envío pre-poblado: el commit NO re-crea/re-agrega lo ya existente. */
  sendState: WizardSendState;
  original: {
    preparerFields: { editorLocalId: string; fieldId: string }[];
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
 * duplicar lo ya creado, y los campos del preparador originales (el upsert no los cubre).
 *
 * Cada firmante vinculado a un cliente (`mappedCustomerId`) es un cliente de la solicitud con localId
 * `client:<customerId>`; si ninguno lo está, el primero hace de cliente (borradores viejos). Los demás
 * usan `seed-<backendId>`.
 * Ojo: SignerResponse no trae canal/teléfono/idioma, así que se muestran por defecto; como el commit
 * no re-agrega firmantes existentes, sus valores reales en el backend se conservan.
 */
export function buildDraftHydration(detail: SignatureRequestDetail): DraftHydration {
  const signers = [...detail.signers].sort((a, b) => a.order - b.order);
  // Un cliente por customerId (el primer firmante que lo trae); sin ninguno, el primer firmante.
  const clientIdBySigner = new Map<string, string>();
  for (const signer of signers) {
    const customerId = signer.mappedCustomerId;
    if (customerId && ![...clientIdBySigner.values()].includes(customerId)) {
      clientIdBySigner.set(signer.id, customerId);
    }
  }
  if (clientIdBySigner.size === 0 && signers[0]) {
    clientIdBySigner.set(signers[0].id, `draft:${detail.id}`);
  }

  const localIdOf = (signerId: string): string => {
    const clientId = clientIdBySigner.get(signerId);
    return clientId ? clientSignerId(clientId) : `seed-${signerId}`;
  };

  const clients: WizardClient[] = signers
    .filter((signer) => clientIdBySigner.has(signer.id))
    .map((signer) => ({
      id: clientIdBySigner.get(signer.id)!,
      displayName: signer.fullName,
      email: signer.email,
      phone: '',
      type: 'individual',
      isActive: true,
      createdAt: '',
    }));

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
  const postedFieldLocalIds: string[] = [];
  const signerIdByLocal: Record<string, string> = {};

  for (const signer of signers) {
    signerIdByLocal[localIdOf(signer.id)] = signer.id;
    for (const field of signer.fields) {
      const localId = `seed-${field.id}`;
      seedFields.push({
        localId,
        documentLocalId: field.documentId,
        type: kindToFieldType(field.kind),
        page: field.page,
        nx: field.x,
        ny: field.y,
        nw: field.width,
        nh: field.height,
        signerLocalId: localIdOf(signer.id),
        label: field.label ?? undefined,
        fontSizePt: field.fontSizePt ?? null,
      });
      postedFieldLocalIds.push(localId);
    }
  }

  // Campos del preparador: viven en el mismo array del editor con signerLocalId = PREPARER_PARTY_ID.
  const preparerOriginal: { editorLocalId: string; fieldId: string }[] = [];
  const postedPreparerFieldLocalIds: string[] = [];
  for (const field of detail.preparerFields) {
    const localId = `seed-prep-${field.id}`;
    seedFields.push({
      localId,
      documentLocalId: field.documentId,
      type: kindToFieldType(field.kind),
      page: field.page,
      nx: field.x,
      ny: field.y,
      nw: field.width,
      nh: field.height,
      signerLocalId: PREPARER_PARTY_ID,
      label: field.label ?? undefined,
    });
    postedPreparerFieldLocalIds.push(localId);
    preparerOriginal.push({ editorLocalId: localId, fieldId: field.id });
  }

  // F7 — mapea los IDs del backend (signerId reales) a los localId del editor para pintar las chips.
  const audienceLocalIds = detail.partialCopyAudienceSignerIds
    .map((serverId) => Object.entries(signerIdByLocal).find(([, id]) => id === serverId)?.[0])
    .filter((id): id is string => !!id);
  const rules: RequestRules = {
    ...defaultRules(),
    sequential: detail.requiresSequentialSigning,
    certificate: detail.generateCertificate,
    certificateGenerationMode: detail.certificateGenerationMode ?? 'SingleForRequest',
    sendSealedDocument: detail.sendSealedDocumentToSigners,
    sendCertificate: detail.sendCertificateToSigners,
    autoReminder: detail.autoRemindersEnabled,
    reminderIntervalHours: detail.reminderIntervalHours,
    sendPartialCopy: detail.sendPartialCopyOnEachSignature,
    partialCopyAudienceKind: detail.partialCopyAudienceKind,
    partialCopyAudienceSignerIds: audienceLocalIds,
    expirationEnabled: detail.expirationEnabled,
  };

  return {
    clients,
    seed: {
      signers: editorSigners,
      fields: seedFields,
      rules,
      preparerSignatureFileId: detail.preparerSignatureFileId,
    },
    sendState: {
      requestId: detail.id,
      documentIdByLocal: Object.fromEntries(
        detail.documents.map((document) => [document.id, document.id]),
      ),
      signerIdByLocal,
      postedFieldLocalIds,
      pinSet: detail.requiresPractitionerPin,
      postedPreparerFieldLocalIds,
      // false a propósito: al guardar/enviar la edición re-aplica la firma elegida actual (idempotente).
      preparerSignatureSet: false,
      // El detalle no devuelve la identidad del preparador; si el usuario no la reingresa, draft.preparerInfo
      // será null y no se toca la existente en el backend.
      preparerInfoSet: false,
      // Al rehidratar un draft la audiencia ya está persistida; re-aplicarla solo si el usuario la cambia.
      audienceApplied: true,
      sent: false,
    },
    original: {
      preparerFields: preparerOriginal,
    },
    metadata: {
      title: detail.title,
      description: detail.description ?? '',
      category: detail.category,
      dueDate: detail.expiresAtUtc ? detail.expiresAtUtc.slice(0, 10) : '',
    },
  };
}
