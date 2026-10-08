import {
  EditorSigner,
  PREPARER_PARTY_ID,
  PlacedField,
} from '../ui/signature-request-panel/signature-wizard.model';
import { ReadinessInput, buildReadinessChecklist } from './editor-readiness.util';

const ana: EditorSigner = {
  id: 'client:1',
  name: 'Ana',
  email: 'a@x.com',
  color: '',
  channel: 'sms',
  phone: '',
  language: 'En',
};

function input(partial: Partial<ReadinessInput>): ReadinessInput {
  return {
    hasDocument: true,
    renderFailed: false,
    rendering: false,
    signers: [ana],
    fields: [],
    signersMissingPhone: [],
    preparerInfoInvalid: false,
    ...partial,
  };
}

const sig = (signerId: string): PlacedField => ({
  id: 'f',
  documentLocalId: 'doc-1',
  type: 'signature',
  page: 1,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  signerId,
});

describe('buildReadinessChecklist', () => {
  it('sin pendientes: lista vacía', () => {
    expect(buildReadinessChecklist(input({ fields: [sig('client:1')] }))).toEqual([]);
  });

  it('render fallido y firmante sin firma (la del preparador no cuenta), con enlace al firmante', () => {
    const items = buildReadinessChecklist(
      input({ renderFailed: true, fields: [sig(PREPARER_PARTY_ID)] }),
    );
    expect(items.map((i) => i.kind)).toEqual(['render-failed', 'missing-signature']);
    expect(items[1].signerId).toBe('client:1');
  });

  it('teléfono faltante y datos 8879 a medias', () => {
    const items = buildReadinessChecklist(
      input({ fields: [sig('client:1')], signersMissingPhone: [ana], preparerInfoInvalid: true }),
    );
    expect(items.map((i) => i.kind)).toEqual(['missing-phone', 'preparer-info']);
  });
});
