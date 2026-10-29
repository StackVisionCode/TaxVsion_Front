import { describe, expect, it } from 'vitest';
import { CustomerSummary } from '@core/customers/customer-summary.model';
import { SignatureRequestDetail, customerToWizardClient, detailToUiRequest } from './signature.model';

function signer(id: string, order: number, mappedCustomerId: string | null) {
  return {
    id,
    email: `${id}@acme.test`,
    fullName: `Signer ${id}`,
    mappedCustomerId,
    order,
    status: 'Pending',
    signedAtUtc: null,
    fields: [],
    partialCopyRequestedAtUtc: null,
    partialCopySentAtUtc: null,
    partialCopyFileId: null,
    partialCopyFailureReason: null,
  };
}

/** Lo mínimo que lee `detailToUiRequest`. */
function detail(signers: ReturnType<typeof signer>[]): SignatureRequestDetail {
  return {
    id: 'req-1',
    title: 'Consent',
    description: null,
    category: 'ConsentToDisclose',
    status: 'InProgress',
    documents: [],
    signers,
    preparerFields: [],
    sentAtUtc: null,
    expiresAtUtc: null,
    completedAtUtc: null,
    certificateFileId: null,
    requiresPractitionerPin: false,
    practitionerPinSetAtUtc: null,
    preparerSignatureFileId: null,
    createdByUserId: 'u1',
    scheduledSendAtUtc: null,
  } as unknown as SignatureRequestDetail;
}

describe('fotos en firmas', () => {
  it('cada firmante lleva el cliente al que está mapeado (para resolver su foto)', () => {
    const ui = detailToUiRequest(detail([signer('b', 2, null), signer('a', 1, 'cust-1')]));

    expect(ui.signers.map(s => [s.id, s.customerId])).toEqual([
      ['a', 'cust-1'],
      ['b', null],
    ]);
  });

  it('el cliente del wizard trae su foto del directorio', () => {
    const summary: CustomerSummary = {
      id: 'cust-1',
      kind: 'Individual',
      status: 'Active',
      displayName: 'Jane Client',
      primaryEmail: 'jane@acme.test',
      primaryPhone: null,
      createdAtUtc: '2026-01-01T00:00:00Z',
      avatarFileId: 'f-1',
    };

    expect(customerToWizardClient(summary).avatarFileId).toBe('f-1');
    expect(customerToWizardClient({ ...summary, avatarFileId: undefined }).avatarFileId).toBeNull();
  });
});
