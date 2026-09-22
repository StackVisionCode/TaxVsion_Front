import { buildDraftHydration, kindToFieldType } from './draft-hydration.util';
import { SignatureRequestDetail, SignerResponse } from '../data-access/signature.model';

function field(id: string, signerId: string, over: Partial<SignerResponse['fields'][number]> = {}) {
  return {
    id,
    signerId,
    kind: 'Signature' as const,
    page: 1,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.05,
    label: null,
    isRequired: true,
    ...over,
  };
}

function detail(): SignatureRequestDetail {
  return {
    id: 'req-1',
    tenantId: 't',
    createdByUserId: 'u',
    title: 'Consent 2026',
    description: 'notes',
    category: 'ConsentToDisclose',
    status: 'Draft',
    originalFileId: 'file-1',
    documentHashPre: null,
    sealedFileId: null,
    documentHashPost: null,
    certificateFileId: null,
    requiresSequentialSigning: true,
    requiresConsent: true,
    generateCertificate: false,
    sendSignedDocumentToSigners: false,
    sendCertificateToSigners: false,
    autoRemindersEnabled: false,
    reminderIntervalHours: 72,
    requiresPractitionerPin: true,
    practitionerPinSetAtUtc: null,
    tokenExpirationHours: 72,
    expiresAtUtc: '2026-10-01T12:00:00Z',
    revocationEpoch: 0,
    createdAtUtc: '2026-09-01T00:00:00Z',
    updatedAtUtc: '2026-09-01T00:00:00Z',
    sentAtUtc: null,
    completedAtUtc: null,
    canceledAtUtc: null,
    expiredAtUtc: null,
    signers: [
      {
        id: 'signer-client',
        email: 'jane@acme.com',
        fullName: 'Jane Client',
        mappedCustomerId: 'cust-1',
        order: 1,
        status: 'Pending',
        signedAtUtc: null,
        fields: [field('field-a', 'signer-client')],
      },
      {
        id: 'signer-extra',
        email: 'bob@acme.com',
        fullName: 'Bob Extra',
        mappedCustomerId: null,
        order: 2,
        status: 'Pending',
        signedAtUtc: null,
        fields: [field('field-b', 'signer-extra', { kind: 'Date' })],
      },
    ],
  };
}

describe('kindToFieldType', () => {
  it('mapea los kinds del backend y degrada Checkbox a texto', () => {
    expect(kindToFieldType('Signature')).toBe('signature');
    expect(kindToFieldType('Initials')).toBe('initials');
    expect(kindToFieldType('Date')).toBe('date');
    expect(kindToFieldType('Text')).toBe('text');
    expect(kindToFieldType('Checkbox')).toBe('text');
  });
});

describe('buildDraftHydration', () => {
  it('reconstruye cliente, seed, sendState y original desde el detalle', () => {
    const h = buildDraftHydration(detail());

    // Cliente = el firmante con mappedCustomerId.
    expect(h.client.id).toBe('cust-1');
    expect(h.client.displayName).toBe('Jane Client');

    // Seed: firmante cliente con localId client:<id>, extra con seed-<id>.
    expect(h.seed.signers.map(s => s.id)).toEqual(['client:cust-1', 'seed-signer-extra']);
    expect(h.seed.rules.sequential).toBe(true);
    expect(h.seed.rules.certificate).toBe(false);
    // Los flags de entrega/reminders se rehidratan desde el detalle (antes se perdían).
    expect(h.seed.rules.sendSignedDocument).toBe(false);
    expect(h.seed.rules.autoReminder).toBe(false);
    expect(h.seed.rules.reminderIntervalHours).toBe(72);

    // Campos normalizados con su firmante mapeado.
    expect(h.seed.fields).toHaveLength(2);
    const clientField = h.seed.fields.find(f => f.localId === 'seed-field-a')!;
    expect(clientField.signerLocalId).toBe('client:cust-1');
    expect(clientField.type).toBe('signature');
    expect(clientField.nx).toBe(0.1);
    expect(h.seed.fields.find(f => f.localId === 'seed-field-b')!.type).toBe('date');

    // sendState pre-poblado: no re-crea nada.
    expect(h.sendState.requestId).toBe('req-1');
    expect(h.sendState.signerIdByLocal).toEqual({
      'client:cust-1': 'signer-client',
      'seed-signer-extra': 'signer-extra',
    });
    expect(h.sendState.postedFieldLocalIds).toEqual(['seed-field-a', 'seed-field-b']);
    expect(h.sendState.pinSet).toBe(true);

    // Original para el diff.
    expect(h.original.signerBackendIds).toEqual(['signer-client', 'signer-extra']);
    expect(h.original.fields).toHaveLength(2);

    // Metadata.
    expect(h.metadata.title).toBe('Consent 2026');
    expect(h.metadata.category).toBe('ConsentToDisclose');
    expect(h.metadata.dueDate).toBe('2026-10-01');
  });
});
