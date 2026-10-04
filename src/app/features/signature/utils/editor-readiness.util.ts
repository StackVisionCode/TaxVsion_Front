import { EditorSigner, PlacedField } from '../ui/signature-request-panel/signature-wizard.model';
import { signersMissingSignature } from './editor-fields.util';

/**
 * Lista "Before you continue" del editor de solicitudes: TODO lo que bloquea "Next"/"Send", con el
 * motivo en lenguaje corriente y, cuando aplica, el firmante al que hay que ir. Pura: el editor la
 * pinta (inspector sin selección / barra móvil) y el panel decide con ella si habilita los botones.
 */
export type ReadinessKind =
  | 'render-failed'
  | 'rendering'
  | 'no-document'
  | 'missing-signature'
  | 'missing-phone'
  | 'preparer-info';

export interface ReadinessItem {
  kind: ReadinessKind;
  message: string;
  /** Firmante afectado (para el enlace "Go to signer"). */
  signerId?: string;
}

export interface ReadinessInput {
  hasDocument: boolean;
  renderFailed: boolean;
  rendering: boolean;
  signers: EditorSigner[];
  fields: PlacedField[];
  signersMissingPhone: EditorSigner[];
  preparerInfoInvalid: boolean;
}

export function buildReadinessChecklist(input: ReadinessInput): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  if (!input.hasDocument) {
    items.push({ kind: 'no-document', message: 'Choose a document in the previous step.' });
  } else if (input.renderFailed) {
    items.push({
      kind: 'render-failed',
      message: "The document couldn't be displayed. Retry to place fields.",
    });
  } else if (input.rendering) {
    items.push({ kind: 'rendering', message: 'The document is still loading.' });
  }
  for (const signer of signersMissingSignature(input.signers, input.fields)) {
    items.push({
      kind: 'missing-signature',
      message: `${signer.name} needs a Signature or Initials field.`,
      signerId: signer.id,
    });
  }
  for (const signer of input.signersMissingPhone) {
    items.push({
      kind: 'missing-phone',
      message: `Add a phone number for ${signer.name} to send the code by text.`,
      signerId: signer.id,
    });
  }
  if (input.preparerInfoInvalid) {
    items.push({
      kind: 'preparer-info',
      message: 'Complete your Form 8879 details (name and PTIN/EFIN), or clear both.',
    });
  }
  return items;
}
