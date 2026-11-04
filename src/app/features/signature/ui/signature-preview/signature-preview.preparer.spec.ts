import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SignatureStore } from '../../data-access/signature.store';
import { SignatureCapabilities } from '../../data-access/signature-permissions';
import { SignatureRequest } from '../signature-table/signature-table.component';
import { SignaturePreviewComponent } from './signature-preview.component';

const SENT: SignatureRequest = {
  id: 'r1',
  documentName: 'Form 8879 - 2025',
  client: 'Ana Doe',
  signers: [],
  status: 'in-progress',
  sentDate: '2026-11-01T10:00:00',
  dueDate: '',
  completedDate: null,
  notes: '',
  documents: [{ id: 'd1', order: 1, title: 'Form 8879', originalFileId: 'f1', sealedFileId: null } as never],
  preparerUserId: 'leaver',
  preparerDisplayName: 'Jane Doe, EA',
  isPreparerSigned: false,
  isActorPreparer: false,
};

function setup(canManageRequests: boolean, canSign = true) {
  TestBed.configureTestingModule({
    imports: [SignaturePreviewComponent],
    providers: [
      { provide: SignatureStore, useValue: { getDownloadUrl: vi.fn(() => of('')) } },
      {
        provide: SignatureCapabilities,
        useValue: { canManageRequests: signal(canManageRequests), canSign: signal(canSign) },
      },
    ],
  });
  // Solo interesa la regla; la plantilla completa la cubre el build.
  TestBed.overrideComponent(SignaturePreviewComponent, { set: { template: '' } });
  return TestBed.createComponent(SignaturePreviewComponent).componentInstance;
}

describe('SignaturePreviewComponent — preparer (Form 8879)', () => {
  it('lets a request manager change the preparer of a sent request that is still unsigned', () => {
    expect(setup(true).canChangePreparer(SENT)).toBe(true);
  });

  it('does not offer the change without signature.request.manage', () => {
    expect(setup(false).canChangePreparer(SENT)).toBe(false);
  });

  it('does not offer the change once the preparer signed, a document was sealed, or on a draft', () => {
    const component = setup(true);

    expect(component.canChangePreparer({ ...SENT, isPreparerSigned: true })).toBe(false);
    expect(
      component.canChangePreparer({
        ...SENT,
        documents: [{ ...SENT.documents[0], sealedFileId: 'sealed' }],
      }),
    ).toBe(false);
    expect(component.canChangePreparer({ ...SENT, status: 'draft' })).toBe(false);
    expect(component.canChangePreparer({ ...SENT, preparerUserId: null })).toBe(false);
  });

  it('shows "Sign as preparer" only to the assigned preparer', () => {
    const component = setup(false);

    expect(component.canSignAsPreparer(SENT)).toBe(false);
    expect(component.canSignAsPreparer({ ...SENT, isActorPreparer: true })).toBe(true);
    expect(component.canSignAsPreparer({ ...SENT, isActorPreparer: true, isPreparerSigned: true })).toBe(false);
  });
});
