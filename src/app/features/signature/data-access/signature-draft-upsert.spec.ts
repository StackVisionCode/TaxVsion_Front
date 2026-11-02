import { describe, expect, it } from 'vitest';
import {
  WizardRequestDraft,
  WizardSendState,
  applyUpsertResult,
  draftToUpsertBody,
  emptySendState,
} from './signature.store';

function draft(over: Partial<WizardRequestDraft> = {}): WizardRequestDraft {
  return {
    title: 'Return 2026',
    description: null,
    category: 'Fiscal',
    documents: [
      { localId: 'doc-old', backendId: 'D1', originalFileId: 'file-1', title: 'Federal.pdf', note: null },
      { localId: 'doc-new', backendId: null, originalFileId: 'file-2', title: 'State.pdf', note: null },
    ],
    tokenExpirationHours: 72,
    requiresSequentialSigning: true,
    requiresConsent: true,
    generateCertificate: true,
    certificateGenerationMode: 'SingleForRequest',
    sendSealedDocumentToSigners: false,
    sendCertificateToSigners: false,
    autoRemindersEnabled: true,
    reminderIntervalHours: 48,
    signingPin: null,
    sendPartialCopyOnEachSignature: false,
    partialCopyAudienceKind: 'All',
    partialCopyAudienceSignerIds: [],
    expirationEnabled: true,
    signers: [
      { localId: 'client:1', fullName: 'Ana', email: 'ana@x.com', language: 'En', phone: null },
      { localId: 'signer-2', fullName: 'Luis', email: 'luis@x.com', language: 'En', phone: null },
    ],
    fields: [
      field('f-new', 'doc-new', 'signer-2'),
      field('f-orphan', 'doc-old', 'signer-gone'),
      field('f-old', 'doc-old', 'client:1'),
    ],
    preparerFields: [],
    preparerSignatureFileId: null,
    preparerInfo: null,
    ...over,
  };
}

function field(localId: string, documentLocalId: string, signerLocalId: string) {
  return {
    localId,
    documentLocalId,
    signerLocalId,
    kind: 'Signature' as const,
    page: 1,
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.05,
    isRequired: true,
    label: null,
  };
}

function hydratedState(): WizardSendState {
  return {
    ...emptySendState(),
    requestId: 'R1',
    documentIdByLocal: { 'doc-old': 'D1' },
    signerIdByLocal: { 'client:1': 'S1' },
    postedFieldLocalIds: ['f-old'],
  };
}

describe('draftToUpsertBody', () => {
  it('sends what already exists with its backend id and what is new without one', () => {
    const body = draftToUpsertBody(draft(), hydratedState(), '2026-11-02T18:00:00Z');

    expect(body.expectedUpdatedAtUtc).toBe('2026-11-02T18:00:00Z');
    expect(body.documents.map((d) => [d.localId, d.id])).toEqual([
      ['doc-old', 'D1'],
      ['doc-new', null],
    ]);
    expect(body.signers.map((s) => s.id)).toEqual(['S1', null]);
    // El campo de un firmante que ya no está no viaja; los demás apuntan a su firmante por índice.
    expect(body.fields.map((f) => [f.signerIndex, f.documentLocalId])).toEqual([
      [1, 'doc-new'],
      [0, 'doc-old'],
    ]);
  });

  it('leaves a Specific audience for later while it names a signer the server does not have yet', () => {
    const specific = draft({
      sendPartialCopyOnEachSignature: true,
      partialCopyAudienceKind: 'Specific',
      partialCopyAudienceSignerIds: ['client:1', 'signer-2'],
    });

    const pending = draftToUpsertBody(specific, hydratedState(), null);
    expect(pending.sendPartialCopyOnEachSignature).toBeNull();
    expect(pending.partialCopyAudience).toBeNull();

    const known = { ...hydratedState(), signerIdByLocal: { 'client:1': 'S1', 'signer-2': 'S2' } };
    expect(draftToUpsertBody(specific, known, null).partialCopyAudience).toEqual({
      kind: 'Specific',
      signerIds: ['S1', 'S2'],
    });
  });
});

describe('applyUpsertResult', () => {
  it('keeps the ids the server resolved so the next save does not create them again', () => {
    const state = hydratedState();
    const current = draft();

    applyUpsertResult(current, state, {
      updatedAtUtc: '2026-11-02T18:01:00Z',
      documents: [
        { localId: 'doc-old', id: 'D1' },
        { localId: 'doc-new', id: 'D2' },
      ],
      signerIds: ['S1', 'S2'],
      fieldIds: ['F1', 'F2'],
    });

    expect(state.documentIdByLocal).toEqual({ 'doc-old': 'D1', 'doc-new': 'D2' });
    expect(state.signerIdByLocal).toEqual({ 'client:1': 'S1', 'signer-2': 'S2' });
    expect(state.postedFieldLocalIds).toEqual(['f-new', 'f-old']);
    const next = draftToUpsertBody(current, state, null);
    expect(next.documents.map((d) => d.id)).toEqual(['D1', 'D2']);
    expect(next.signers.map((s) => s.id)).toEqual(['S1', 'S2']);
  });
});
