import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import type { ClientFormRequestDetail } from './client-forms.model';
import { ClientFormsService } from './client-forms.service';
import { ClientFormsStore } from './client-forms.store';

function detail(): ClientFormRequestDetail {
  return {
    request: {
      id: 'request-1',
      responsibleUserId: null,
      title: 'Organizer',
      status: 'Submitted',
      dueAtUtc: null,
      progressPercent: 100,
      currentRevisionNumber: 1,
      rowVersion: 'AQ==',
    },
    definition: {
      schemaVersion: 1,
      title: 'Organizer',
      purpose: 'general',
      presentation: 'wizard',
      pages: [],
    },
    progressPercent: 100,
    revisions: [],
    latestRevisionAnswers: { schemaVersion: 1, values: {} },
    attachments: [],
    timeline: [],
    actionRuns: [],
  };
}

describe('ClientFormsStore', () => {
  let store: ClientFormsStore;
  let service: {
    list: ReturnType<typeof vi.fn>;
    templates: ReturnType<typeof vi.fn>;
    detail: ReturnType<typeof vi.fn>;
    revision: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      list: vi.fn(() => of({ items: [], page: 1, size: 100, totalCount: 0 })),
      templates: vi.fn(() => of([])),
      detail: vi.fn(() => of(detail())),
      revision: vi.fn(() =>
        of({
          number: 1,
          submittedAtUtc: '2026-10-24T10:00:00',
          outcome: 'Pending',
          reviewMessage: null,
          fieldComments: [],
          answers: { schemaVersion: 1, values: {} },
        }),
      ),
      complete: vi.fn(() => of(detail().request)),
    };
    TestBed.configureTestingModule({
      providers: [ClientFormsStore, { provide: ClientFormsService, useValue: service }],
    });
    store = TestBed.inject(ClientFormsStore);
  });

  it('loads requests and assignable templates for one client', async () => {
    await store.load('customer-1');
    expect(service.list).toHaveBeenCalledWith('customer-1');
    expect(service.templates).toHaveBeenCalled();
  });

  it('reloads detail and list when a transition has a stale row version', async () => {
    await store.load('customer-1');
    await store.open('request-1');
    service.complete.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'FormRequest.Concurrency', message: 'Changed.' },
          }),
      ),
    );

    await expect(store.complete(null)).resolves.toBe(false);
    expect(service.detail).toHaveBeenCalledTimes(2);
    expect(service.list).toHaveBeenCalledTimes(2);
  });
});
