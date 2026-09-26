import { computeDraftEditPlan, DraftEditOriginal, WizardRequestDraft, WizardSendState } from './signature.store';

function draft(signerLocalIds: string[], fieldLocalIds: { localId: string; signerLocalId: string }[]): WizardRequestDraft {
  return {
    title: 'x',
    description: null,
    category: 'Fiscal',
    originalFileId: 'f',
    tokenExpirationHours: 72,
    requiresSequentialSigning: true,
    requiresConsent: true,
    generateCertificate: false,
    sendSignedDocumentToSigners: true,
    sendCertificateToSigners: false,
    autoRemindersEnabled: true,
    reminderIntervalHours: 48,
    signingPin: null,
    signers: signerLocalIds.map(localId => ({
      localId,
      fullName: 'n',
      email: 'e@e.com',
      language: 'En',
      phone: null,
    })),
    fields: fieldLocalIds.map(f => ({
      localId: f.localId,
      signerLocalId: f.signerLocalId,
      kind: 'Signature',
      page: 1,
      x: 0,
      y: 0,
      width: 0.1,
      height: 0.1,
      isRequired: true,
      label: null,
    })),
    preparerFields: [],
    preparerSignatureFileId: null,
    preparerInfo: null,
  };
}

describe('computeDraftEditPlan', () => {
  const original: DraftEditOriginal = {
    signerBackendIds: ['S1', 'S2'],
    fields: [
      { editorLocalId: 'client:c', fieldId: 'F1', signerBackendId: 'S1' },
      { editorLocalId: 'seed-x', fieldId: 'F2', signerBackendId: 'S2' },
    ],
    preparerFields: [],
  };
  const state: WizardSendState = {
    requestId: 'req',
    signerIdByLocal: { 'client:c': 'S1', 'seed-s2': 'S2' },
    postedFieldLocalIds: ['client:c', 'seed-x'],
    pinSet: false,
    postedPreparerFieldLocalIds: [],
    preparerSignatureSet: false,
    preparerInfoSet: false,
    sent: false,
  };

  it('sin cambios no borra nada', () => {
    const plan = computeDraftEditPlan(
      draft(['client:c', 'seed-s2'], [
        { localId: 'client:c', signerLocalId: 'client:c' },
        { localId: 'seed-x', signerLocalId: 'seed-s2' },
      ]),
      state,
      original,
    );
    expect(plan.removeSignerBackendIds).toEqual([]);
    expect(plan.removeFields).toEqual([]);
  });

  it('quitar un firmante lo marca para borrar y NO lista sus campos (cascada)', () => {
    const plan = computeDraftEditPlan(
      // se quedó solo el cliente; se quitó seed-s2 (y con él, su campo seed-x)
      draft(['client:c'], [{ localId: 'client:c', signerLocalId: 'client:c' }]),
      state,
      original,
    );
    expect(plan.removeSignerBackendIds).toEqual(['S2']);
    expect(plan.removeFields).toEqual([]); // F2 cae por cascada al borrar S2
  });

  it('quitar un campo de un firmante que sobrevive lo marca para borrar', () => {
    const plan = computeDraftEditPlan(
      draft(['client:c', 'seed-s2'], [{ localId: 'seed-x', signerLocalId: 'seed-s2' }]),
      state,
      original,
    );
    expect(plan.removeSignerBackendIds).toEqual([]);
    expect(plan.removeFields).toEqual([{ signerBackendId: 'S1', fieldId: 'F1' }]);
  });
});
