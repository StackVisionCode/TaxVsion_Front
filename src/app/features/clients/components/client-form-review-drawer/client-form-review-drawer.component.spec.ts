import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccessStore } from '@core/access/access.store';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import type {
  ClientFormRequestDetail,
  ClientFormRequestStatus,
} from '../../data-access/client-forms.model';
import { ClientFormsStore } from '../../data-access/client-forms.store';
import { ClientFormReviewDrawerComponent } from './client-form-review-drawer.component';

function detail(status: ClientFormRequestStatus): ClientFormRequestDetail {
  return {
    request: {
      id: 'request-1',
      responsibleUserId: null,
      title: 'Organizer',
      status,
      dueAtUtc: null,
      progressPercent: 100,
      currentRevisionNumber: 1,
      rowVersion: 'AQ==',
    },
    definition: {
      schemaVersion: 1,
      title: 'Organizer',
      purpose: 'general',
      presentation: 'singlePage',
      pages: [],
    },
    progressPercent: 100,
    revisions: [],
    latestRevisionAnswers: null,
    attachments: [],
    timeline: [],
    actionRuns: [],
  };
}

describe('ClientFormReviewDrawerComponent', () => {
  const state = {
    detail: signal<ClientFormRequestDetail | null>(null),
    actionError: signal<string | null>(null),
  };
  const store = {
    detail: state.detail.asReadonly(),
    actionError: state.actionError.asReadonly(),
    busy: () => false,
    revision: () => null,
    previousRevision: () => null,
    reveal: vi.fn(async () => ''),
    cancel: vi.fn(async () => {
      state.actionError.set('This request is already completed.');
      return false;
    }),
    dismissActionError: vi.fn(() => state.actionError.set(null)),
    close: vi.fn(),
  };
  const toast = { success: vi.fn() };

  beforeEach(() => {
    state.detail.set(null);
    state.actionError.set(null);
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: ClientFormsStore, useValue: store },
        {
          provide: AccessStore,
          useValue: {
            can: (permission: string) =>
              ['tasks.form_requests.manage', 'tasks.form_requests.review'].includes(permission),
          },
        },
        { provide: CloudStorageUploadService, useValue: { viewerItemForId: vi.fn() } },
        { provide: ToastService, useValue: toast },
      ],
    });
  });

  // El drawer se porta al body: se consulta el documento, no el host.
  function render(status: ClientFormRequestStatus) {
    state.detail.set(detail(status));
    const fixture = TestBed.createComponent(ClientFormReviewDrawerComponent);
    fixture.componentInstance.clientName = 'Acme LLC';
    fixture.detectChanges();
    return fixture;
  }

  function drawerButtons(): string[] {
    return Array.from(document.querySelectorAll('aside button'))
      .map((button) => button.textContent?.trim() ?? '')
      .filter(Boolean);
  }

  it('hides Cancel and the due date change once the request is completed or cancelled', () => {
    for (const status of ['Completed', 'Cancelled'] as const) {
      const fixture = render(status);
      expect(drawerButtons()).not.toContain('Cancel');
      expect(drawerButtons()).not.toContain('Change');
      fixture.destroy();
    }
  });

  it('keeps Cancel while open and the due date change only while the client can edit', () => {
    let fixture = render('Submitted');
    expect(drawerButtons()).toEqual(
      expect.arrayContaining(['Request changes', 'Complete', 'Cancel']),
    );
    expect(drawerButtons()).not.toContain('Change');
    fixture.destroy();

    fixture = render('Pending');
    expect(drawerButtons()).toEqual(expect.arrayContaining(['Change', 'Cancel']));
    fixture.destroy();
  });

  it('shows a failed action inside the open dialog and clears it on close', async () => {
    const fixture = render('Submitted');
    const component = fixture.componentInstance;

    component.openAction('cancel');
    fixture.detectChanges();
    await component.submitAction({ kind: 'cancel', note: null, dueAtUtc: null });
    fixture.detectChanges();

    const alerts = Array.from(document.querySelectorAll('[role="alert"]'));
    expect(alerts.map((alert) => alert.textContent?.trim())).toEqual([
      'This request is already completed.',
    ]);
    expect(component.action()).toBe('cancel');

    component.closeAction();
    expect(state.actionError()).toBeNull();
    expect(component.action()).toBeNull();
    fixture.destroy();
  });

  it('opens each action without the error of a previous one', () => {
    const fixture = render('Submitted');
    state.actionError.set('Old error');

    fixture.componentInstance.beginReturn();

    expect(state.actionError()).toBeNull();
    // "Request changes" solo entra en modo revisión; el diálogo se abre con "Send request".
    expect(fixture.componentInstance.action()).toBeNull();
    expect(fixture.componentInstance.requestChangesMode()).toBe(true);
    state.actionError.set('Old error');
    fixture.componentInstance.sendReturn();
    expect(state.actionError()).toBeNull();
    expect(fixture.componentInstance.action()).toBe('return');
    fixture.componentInstance.cancelReturn();
    expect(fixture.componentInstance.requestChangesMode()).toBe(false);
    fixture.destroy();
  });

  it('names the client from the profile, not from a list row', () => {
    const fixture = render('Submitted');

    expect(document.body.textContent).toContain('Acme LLC');
    fixture.destroy();
  });
});
