import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import type { StaffFormRequestDetail } from './client-forms.model';
import { FormRequestsService } from './form-requests.service';
import { FormRequestsStore } from './form-requests.store';

function detail(status: 'Requested' | 'Completed' = 'Completed'): StaffFormRequestDetail {
  return {
    request: {
      id: 'request-1',
      participant: { kind: 'External', customerId: null, participantId: 'participant-1' },
      origin: 'Directed',
      customerLinkStatus: 'None',
      responsibleUserId: null,
      formTemplateId: 'template-1',
      formTemplateVersionId: 'version-1',
      versionNumber: 1,
      title: 'Organizer',
      messageToClient: null,
      taxYear: null,
      taskId: null,
      dueAtUtc: null,
      status: 'Submitted',
      progressPercent: 100,
      currentRevisionNumber: 1,
      lastSubmittedAtUtc: '2026-10-24T10:00:00',
      rowVersion: 'AQ==',
    },
    definition: {
      schemaVersion: 1,
      title: 'Organizer',
      purpose: 'general',
      presentation: 'wizard',
      pages: [],
      actions: [],
    },
    progressPercent: 100,
    revisions: [],
    latestRevisionAnswers: { schemaVersion: 1, values: {} },
    attachments: [],
    consents: [],
    timeline: [],
    actionRuns: [
      {
        id: 'run-1',
        revisionNumber: 1,
        actionKey: 'create',
        actionType: 'CreateCustomer',
        status,
        attempt: 1,
        requestedAtUtc: '2026-10-24T10:00:00',
        completedAtUtc: null,
        resultRefKind: null,
        resultRefId: null,
        existingCustomerId: null,
        errorCode: null,
        errorDetail: null,
        warnings: [],
        isLatestAttempt: true,
        canRetry: false,
      },
    ],
    customerLink: { status: 'None', customerId: null, reason: null, conflictingRequestId: null },
    displayName: 'Ada Lovelace',
    maskedEmail: 'a***@example.com',
  };
}

describe('FormRequestsStore', () => {
  let service: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    revision: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  let store: FormRequestsStore;

  beforeEach(() => {
    service = {
      list: vi.fn(() => of({ items: [], page: 1, size: 25, totalCount: 0 })),
      get: vi.fn(() => of(detail())),
      revision: vi.fn(() =>
        of({
          number: 1,
          submittedAtUtc: '2026-10-24T10:00:00',
          outcome: 'Pending',
          reviewMessage: null,
          fieldComments: [],
          pdfStatus: 'None',
          pdfFileId: null,
          answers: { schemaVersion: 1, values: {} },
          consents: [],
        }),
      ),
      complete: vi.fn(() => of(detail().request)),
    };
    TestBed.configureTestingModule({
      providers: [FormRequestsStore, { provide: FormRequestsService, useValue: service }],
    });
    store = TestBed.inject(FormRequestsStore);
  });

  it('loads the default needs-action view', async () => {
    await store.load();
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ view: 'NeedsAction' }));
  });

  it('reloads the detail and list after a 409', async () => {
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
    expect(service.get).toHaveBeenCalledTimes(2);
    expect(service.list).toHaveBeenCalled();
  });

  it('polls every five seconds while an action remains requested', async () => {
    vi.useFakeTimers();
    service.get
      .mockReturnValueOnce(of(detail('Requested')))
      .mockReturnValueOnce(of(detail('Completed')));
    await store.open('request-1');
    expect(service.get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(service.get).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(service.get).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
