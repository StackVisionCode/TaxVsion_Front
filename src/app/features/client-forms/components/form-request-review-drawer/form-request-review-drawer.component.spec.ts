import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccessStore } from '@core/access/access.store';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ClientFormsAvailabilityStore } from '../../data-access/client-forms-availability.store';
import type {
  FormRequestListItem,
  FormRequestStatus,
  ProfileUpdateField,
  StaffFormRequestDetail,
} from '../../data-access/client-forms.model';
import { FormRequestsService } from '../../data-access/form-requests.service';
import { FormRequestsStore } from '../../data-access/form-requests.store';
import { FormRequestReviewDrawerComponent } from './form-request-review-drawer.component';

function detail(status: FormRequestStatus = 'Submitted'): StaffFormRequestDetail {
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
      status,
      progressPercent: 100,
      currentRevisionNumber: 1,
      lastSubmittedAtUtc: '2026-10-24T10:00:00',
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
    consents: [],
    timeline: [],
    actionRuns: [],
    customerLink: { status: 'None', customerId: null, reason: null, conflictingRequestId: null },
    displayName: 'Ada Lovelace',
    maskedEmail: 'a***@example.com',
  };
}

describe('FormRequestReviewDrawerComponent', () => {
  const permissions = signal(new Set<string>());
  const profileFields = signal<ProfileUpdateField[]>([]);
  const state = {
    detail: signal<StaffFormRequestDetail | null>(null),
    selectedItem: signal<FormRequestListItem | null>(null),
    actionError: signal<string | null>(null),
  };
  const store = {
    detail: state.detail.asReadonly(),
    selectedItem: state.selectedItem.asReadonly(),
    actionError: state.actionError.asReadonly(),
    detailLoading: () => false,
    actionBusy: () => false,
    processingTimedOut: () => false,
    revision: () => null,
    previousRevision: () => null,
    profileFields: profileFields.asReadonly(),
    profileFieldsLoading: () => false,
    loadProfileFields: vi.fn(async () => {}),
    applyProfileUpdate: vi.fn(async () => true),
    reveal: vi.fn(async () => '123-45-6789'),
    changeDueDate: vi.fn(async () => true),
    sendReminder: vi.fn(async () => true),
    archive: vi.fn(async () => {
      state.actionError.set('This request can no longer be changed.');
      return false;
    }),
    dismissActionError: vi.fn(() => state.actionError.set(null)),
    close: vi.fn(),
  };
  const toast = { success: vi.fn(), info: vi.fn() };
  const externalEnabled = signal(true);
  const service = {
    activeStaff: () => of([]),
    resendExternalAccess: vi.fn(() => of(undefined)),
  };

  beforeEach(() => {
    permissions.set(
      new Set([
        'tasks.form_submissions.reveal',
        'tasks.form_requests.manage',
        'tasks.form_requests.review',
        'tasks.form_requests.send_external',
      ]),
    );
    externalEnabled.set(true);
    state.detail.set(null);
    state.selectedItem.set(null);
    state.actionError.set(null);
    profileFields.set([]);
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: FormRequestsStore, useValue: store },
        { provide: FormRequestsService, useValue: service },
        {
          provide: ClientFormsAvailabilityStore,
          useValue: { externalParticipantsEnabled: externalEnabled.asReadonly() },
        },
        {
          provide: AccessStore,
          useValue: {
            can: (permission: string) => permissions().has(permission),
            isAdmin: signal(true),
          },
        },
        { provide: CloudStorageUploadService, useValue: { viewerItemForId: vi.fn() } },
        { provide: ToastService, useValue: toast },
      ],
    });
  });

  function create() {
    return TestBed.runInInjectionContext(() => new FormRequestReviewDrawerComponent());
  }

  // El drawer se porta al body: se consulta el documento, no el host.
  function render(status: FormRequestStatus) {
    state.detail.set(detail(status));
    const fixture = TestBed.createComponent(FormRequestReviewDrawerComponent);
    fixture.detectChanges();
    return fixture;
  }

  function drawerButtons(): string[] {
    return Array.from(document.querySelectorAll('aside button'))
      .map((button) => button.textContent?.trim() ?? '')
      .filter(Boolean);
  }

  it('enters review mode on Request changes and opens the dialog only on Send request', () => {
    const fixture = render('Submitted');
    const component = fixture.componentInstance;
    const click = (label: string) =>
      (Array.from(document.querySelectorAll('aside button')).find(
        (button) => button.textContent?.trim() === label,
      ) as HTMLButtonElement).click();

    click('Request changes');
    fixture.detectChanges();
    expect(component.action()).toBeNull();
    expect(component.requestChangesMode()).toBe(true);
    expect(drawerButtons()).toEqual(expect.arrayContaining(['Cancel', 'Send request']));
    expect(drawerButtons()).not.toContain('Complete');

    component.comments.set({ 'fd_a:': 'Please fix', 'fd_b:': '  ' });
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="request-changes-mode"]')?.textContent).toContain('1 comment');
    click('Send request');
    fixture.detectChanges();
    expect(component.action()).toBe('return');
    expect(component.commentCount()).toBe(1);

    component.closeAction();
    fixture.detectChanges();
    expect(component.requestChangesMode()).toBe(true);
    click('Cancel');
    fixture.detectChanges();
    expect(component.requestChangesMode()).toBe(false);
    expect(component.comments()).toEqual({});
    fixture.destroy();
  });

  it('sends a reminder from the confirm dialog on an open request', async () => {
    const fixture = render('Pending');
    const component = fixture.componentInstance;
    expect(component.canSendReminder()).toBe(true);
    expect(document.querySelector('[data-testid="send-reminder"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="reminder-count"]')?.textContent).toContain('0/5');

    component.openReminder();
    fixture.detectChanges();
    await component.sendReminder();
    expect(store.sendReminder).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Reminder sent');
    expect(component.reminderOpen()).toBe(false);
    fixture.destroy();
  });

  describe('client creation waiting for the signature', () => {
    const waiting = () => {
      const value = detail('Completed');
      value.definition.actions = [
        { key: 'create_client', type: 'createCustomer', trigger: 'onSubmit', config: { waitFor: 'signatureCompleted' } },
      ];
      value.revisions = [
        {
          number: 1,
          submittedAtUtc: '2026-10-24T10:00:00',
          outcome: 'Completed',
          reviewMessage: null,
          fieldComments: [],
          pdfStatus: 'Ready',
          pdfFileId: null,
          signatureStatus: 'Sent',
        },
      ];
      return value;
    };

    beforeEach(() => permissions.update((set) => new Set([...set, 'customers.manage'])));

    it('says it waits and hides Start onboarding until there is a run', () => {
      state.detail.set(waiting());
      const fixture = TestBed.createComponent(FormRequestReviewDrawerComponent);
      fixture.detectChanges();

      expect(document.querySelector('[data-testid="waiting-signature"]')?.textContent).toContain(
        'Waiting for signature',
      );
      expect(drawerButtons()).not.toContain('Start onboarding');
      fixture.destroy();
    });

    it('stops waiting once the signature ended or the run exists', () => {
      const declined = waiting();
      declined.revisions[0].signatureStatus = 'Declined';
      state.detail.set(declined);
      expect(create().waitsForSignature()).toBe(false);

      const ran = waiting();
      ran.actionRuns = [{ actionType: 'CreateCustomer' } as StaffFormRequestDetail['actionRuns'][number]];
      state.detail.set(ran);
      expect(create().waitsForSignature()).toBe(false);

      const noWait = waiting();
      noWait.definition.actions = [{ key: 'create_client', type: 'createCustomer', trigger: 'onSubmit' }];
      state.detail.set(noWait);
      expect(create().waitsForSignature()).toBe(false);
    });
  });

  it('hides Send reminder once the request is completed', () => {
    const fixture = render('Completed');
    expect(fixture.componentInstance.canSendReminder()).toBe(false);
    expect(document.querySelector('[data-testid="send-reminder"]')).toBeNull();
    fixture.destroy();
  });

  it('reacts to permission changes without reopening the drawer', () => {
    const component = create();
    expect(component.canReveal()).toBe(true);
    permissions.set(new Set(['tasks.form_requests.manage']));
    expect(component.canReveal()).toBe(false);
    expect(component.canManage()).toBe(true);
  });

  it('delegates reveal to the store', async () => {
    const component = create();
    await expect(component.revealValue('ref-1')).resolves.toBe('123-45-6789');
    expect(store.reveal).toHaveBeenCalledWith('ref-1');
  });

  it('sends the due date as midnight UTC of the chosen calendar day', async () => {
    const component = create();
    component.openDialog('dueDate');
    expect(component.action()).toBe('dueDate');
    await component.submitAction({ kind: 'dueDate', note: null, dueAtUtc: '2026-11-15T00:00:00Z' });
    expect(store.changeDueDate).toHaveBeenCalledWith('2026-11-15T00:00:00Z');
    expect(component.action()).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('Due date updated');
  });

  it('hides Cancel, Archive and the due date change on a completed request but keeps Assign', () => {
    const fixture = render('Completed');

    const buttons = drawerButtons();
    expect(buttons).toContain('Assign');
    expect(buttons).not.toContain('Cancel');
    expect(buttons).not.toContain('Archive');
    expect(buttons).not.toContain('Change');
    fixture.destroy();
  });

  it('hides every management action on a cancelled request', () => {
    const fixture = render('Cancelled');

    const buttons = drawerButtons();
    expect(buttons).not.toContain('Assign');
    expect(buttons).not.toContain('Cancel');
    expect(buttons).not.toContain('Archive');
    expect(buttons).not.toContain('Change');
    fixture.destroy();
  });

  it('offers Cancel and Archive while open and the due date only while the participant can edit', () => {
    let fixture = render('Submitted');
    expect(drawerButtons()).toEqual(
      expect.arrayContaining(['Request changes', 'Complete', 'Cancel', 'Archive']),
    );
    expect(drawerButtons()).not.toContain('Change');
    fixture.destroy();

    fixture = render('Returned');
    expect(drawerButtons()).toEqual(expect.arrayContaining(['Change', 'Cancel', 'Archive']));
    fixture.destroy();
  });

  it('shows a failed action inside the open dialog instead of behind it', async () => {
    const fixture = render('Submitted');
    const component = fixture.componentInstance;

    component.openDialog('archive');
    fixture.detectChanges();
    await component.submitAction({ kind: 'archive', note: null, dueAtUtc: null });
    fixture.detectChanges();

    const alerts = Array.from(document.querySelectorAll('[role="alert"]'));
    expect(alerts.map((alert) => alert.textContent?.trim())).toEqual([
      'This request can no longer be changed.',
    ]);
    expect(component.action()).toBe('archive');
    expect(component.modalOpen()).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();

    component.closeAction();
    expect(store.dismissActionError).toHaveBeenCalled();
    expect(state.actionError()).toBeNull();
    fixture.destroy();
  });

  it('starts each dialog without the error of a previous action', () => {
    const component = create();
    state.actionError.set('Old error');

    component.openDialog('cancel');

    expect(state.actionError()).toBeNull();
  });

  it('names the participant from the detail when the request is not in the loaded list (deep link)', () => {
    const fixture = render('Submitted');

    expect(fixture.componentInstance.participantName()).toBe('Ada Lovelace');
    expect(fixture.componentInstance.participantEmail()).toBe('a***@example.com');
    expect(document.body.textContent).toContain('Ada Lovelace');
    expect(document.body.textContent).toContain('a***@example.com');
    fixture.destroy();
  });

  it('prefers the selected list row over the detail for the participant', () => {
    const component = create();
    state.detail.set(detail());
    state.selectedItem.set({ displayName: 'Row name', maskedEmail: 'r***@example.com' } as FormRequestListItem);

    expect(component.participantName()).toBe('Row name');
    expect(component.participantEmail()).toBe('r***@example.com');
  });

  it('falls back to the detail email when the row has none', () => {
    const component = create();
    state.detail.set(detail());
    state.selectedItem.set({ displayName: 'Row name', maskedEmail: null } as FormRequestListItem);

    expect(component.participantEmail()).toBe('a***@example.com');
  });

  it('offers Resend link on an open external request with the permission and the office flag', () => {
    let fixture = render('Pending');
    expect(drawerButtons()).toContain('Resend link');
    fixture.destroy();

    fixture = render('Returned');
    expect(drawerButtons()).toContain('Resend link');
    fixture.destroy();

    fixture = render('Completed');
    expect(drawerButtons()).not.toContain('Resend link');
    fixture.destroy();
  });

  // Enviada: el participante ya no edita, reenviar el enlace no sirve.
  it('hides Resend link on a submitted request', () => {
    const fixture = render('Submitted');
    expect(drawerButtons()).not.toContain('Resend link');
    fixture.destroy();
  });

  it('offers Resend link only on directed requests, not on intake link requests', () => {
    const directed = detail('Pending');
    directed.request.origin = 'Directed';
    state.detail.set(directed);
    let fixture = TestBed.createComponent(FormRequestReviewDrawerComponent);
    fixture.detectChanges();
    expect(drawerButtons()).toContain('Resend link');
    fixture.destroy();

    const intake = detail('Pending');
    intake.request.origin = 'IntakeLink';
    state.detail.set(intake);
    fixture = TestBed.createComponent(FormRequestReviewDrawerComponent);
    fixture.detectChanges();
    expect(drawerButtons()).not.toContain('Resend link');
    fixture.destroy();
  });

  // Compatibilidad: un backend previo sin `origin` se trata como request dirigida.
  it('offers Resend link when origin is missing', () => {
    const legacy = detail('Pending');
    delete (legacy.request as { origin?: string }).origin;
    state.detail.set(legacy);
    const fixture = TestBed.createComponent(FormRequestReviewDrawerComponent);
    fixture.detectChanges();
    expect(drawerButtons()).toContain('Resend link');
    fixture.destroy();
  });

  function resendFails(status: number, code: string): void {
    service.resendExternalAccess.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status, error: { code, message: 'Backend text' } })),
    );
  }

  it('explains a request without a personal access link (409) without saying the feature is off', async () => {
    resendFails(409, 'FormRequest.NoAccessLink');
    const component = create();
    state.detail.set(detail('Pending'));

    component.openResend();
    await component.resendAccess();

    expect(component.resendError()).toBe('This request has no personal access link to resend.');
  });

  it('explains that links are only resent while pending or returned (409)', async () => {
    resendFails(409, 'FormRequest.ResendNotAllowed');
    const component = create();
    state.detail.set(detail('Pending'));

    await component.resendAccess();

    expect(component.resendError()).toContain('pending or returned');
  });

  it('explains a 404 as turned off or no longer visible', async () => {
    resendFails(404, 'FormRequest.NotFound');
    const component = create();
    state.detail.set(detail('Pending'));

    await component.resendAccess();

    expect(component.resendError()).toContain('no longer have access');
  });

  it('hides Resend link when the office turned external participants off', () => {
    externalEnabled.set(false);
    const fixture = render('Pending');
    expect(drawerButtons()).not.toContain('Resend link');
    fixture.destroy();
  });

  it('hides Resend link without the send_external permission', () => {
    permissions.set(new Set(['tasks.form_requests.manage']));
    const fixture = render('Pending');
    expect(drawerButtons()).not.toContain('Resend link');
    fixture.destroy();
  });

  it('resends the access link after confirming', async () => {
    const component = create();
    state.detail.set(detail('Pending'));

    component.openResend();
    expect(component.resendOpen()).toBe(true);
    await component.resendAccess();

    expect(service.resendExternalAccess).toHaveBeenCalledWith('request-1');
    expect(component.resendOpen()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Access link resent');
  });

  it('keeps the confirmation open and explains the resend limit', async () => {
    service.resendExternalAccess.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              code: 'FormAccessGrant.IssueLimit',
              message: 'The access grant issue limit was reached.',
            },
          }),
      ),
    );
    const component = create();
    state.detail.set(detail('Pending'));

    component.openResend();
    await component.resendAccess();

    expect(component.resendOpen()).toBe(true);
    expect(component.resendError()).toContain('maximum number of times');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('applies selected fields and the tax identifier to the client profile', async () => {
    permissions.set(
      new Set([
        'tasks.form_requests.manage',
        'tasks.form_requests.review',
        'tasks.form_requests.apply_profile',
      ]),
    );
    profileFields.set([
      {
        componentId: 'c1',
        label: 'Phone',
        targetKey: 'customer.primary_phone',
        targetDisplayName: 'Primary phone',
        dataType: 'Phone',
        requiresAdmin: false,
        isTaxId: false,
      },
      {
        componentId: 'c2',
        label: 'SSN',
        targetKey: 'customer.fiscal.tax_identifier',
        targetDisplayName: 'Tax identifier',
        dataType: 'TaxId',
        requiresAdmin: true,
        isTaxId: true,
      },
    ]);
    const component = create();
    state.detail.set(detail('Completed'));

    component.toggleField('c1', true);
    component.includeTaxIdentifier.set(true);
    await component.applyProfile();

    expect(store.applyProfileUpdate).toHaveBeenCalledWith({
      componentIds: ['c1', 'c2'],
      includeTaxIdentifier: true,
    });
    expect(toast.info).toHaveBeenCalledWith('Profile update requested');
  });

  it('announces an action error at the top of the drawer and offers a sized dismiss button', () => {
    const fixture = render('Submitted');
    state.actionError.set('This request can no longer be changed.');
    fixture.detectChanges();

    const alert = Array.from(document.querySelectorAll('aside [role="alert"]')).find((node) =>
      node.textContent?.includes('This request can no longer be changed.'),
    );
    expect(alert).toBeTruthy();
    const dismiss = alert?.querySelector('button[aria-label="Dismiss error"]') as HTMLButtonElement;
    expect(dismiss.className).toContain('h-8 w-8');
    fixture.destroy();
  });
});
