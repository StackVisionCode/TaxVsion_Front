import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import { of } from 'rxjs';
import type { FormProspect } from '../../data-access/client-forms.model';
import { ClientFormsAvailabilityStore } from '../../data-access/client-forms-availability.store';
import { FormProspectsService } from '../../data-access/form-prospects.service';
import { FormRequestsService } from '../../data-access/form-requests.service';
import { FormRequestsStore } from '../../data-access/form-requests.store';
import { prospect } from '../../testing/prospect.fixture';
import { SendExternalFormDialogComponent } from '../../ui/send-external-form-dialog/send-external-form-dialog.component';
import { FormRequestReviewDrawerComponent } from '../form-request-review-drawer/form-request-review-drawer.component';
import { FormProspectsComponent } from './form-prospects.component';

const ALL = ['tasks.form_requests.read', 'tasks.form_requests.send_external'];

describe('FormProspectsComponent', () => {
  const permissions = signal(new Set(ALL));
  const externalEnabled = signal(true);
  const prospects = { list: vi.fn(), markLost: vi.fn(), reopen: vi.fn() };
  const requests = {
    startCustomerCreation: vi.fn(() => of({ id: 'run-1' })),
    resendExternalAccess: vi.fn(() => of(undefined)),
    assignableTemplates: vi.fn(() => of([])),
    entryNotices: vi.fn(() => of([])),
    assignExternal: vi.fn(),
  };
  const requestsStore = { open: vi.fn(async () => undefined) };
  const router = { navigate: vi.fn() };
  const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() };

  function render(items: FormProspect[] = [prospect()]): ComponentFixture<FormProspectsComponent> {
    prospects.list.mockReturnValue(of({ items, page: 1, size: 25, totalCount: items.length }));
    TestBed.configureTestingModule({
      imports: [FormProspectsComponent],
      providers: [
        { provide: FormProspectsService, useValue: prospects },
        { provide: FormRequestsService, useValue: requests },
        { provide: FormRequestsStore, useValue: requestsStore },
        { provide: Router, useValue: router },
        { provide: ToastService, useValue: toast },
        {
          provide: AccessStore,
          useValue: { can: (permission: string) => permissions().has(permission), isAdmin: () => true },
        },
        {
          provide: ClientFormsAvailabilityStore,
          useValue: { externalParticipantsEnabled: externalEnabled.asReadonly() },
        },
      ],
    });
    // El drawer y el diálogo tienen sus propias specs; aquí basta con sus entradas.
    TestBed.overrideComponent(FormProspectsComponent, {
      remove: { imports: [FormRequestReviewDrawerComponent, SendExternalFormDialogComponent] },
    });
    const fixture = TestBed.createComponent(FormProspectsComponent);
    fixture.detectChanges();
    return fixture;
  }

  async function settle(fixture: ComponentFixture<FormProspectsComponent>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    permissions.set(new Set(ALL));
    externalEnabled.set(true);
  });

  afterEach(() => {
    document.body.querySelectorAll('.dm-panel').forEach((node) => node.remove());
  });

  describe('actions per status', () => {
    let component: FormProspectsComponent;
    beforeEach(() => {
      component = render([]).componentInstance;
    });
    const actions = (patch: Partial<FormProspect>) => component.availableActions(prospect(patch));

    it('offers create, send, resend and lost to an open directed prospect', () => {
      expect(actions({ status: 'Submitted', canCreateClient: true })).toEqual([
        'openRequest',
        'createClient',
        'sendForm',
        'resendLink',
        'markLost',
      ]);
    });

    it('hides Create client when the server says no and Resend for intake or closed requests', () => {
      expect(actions({ status: 'Invited' })).toEqual(['openRequest', 'sendForm', 'resendLink', 'markLost']);
      expect(actions({ source: 'IntakeLink' })).not.toContain('resendLink');
      expect(
        actions({ latestRequest: { id: 'r', title: 'T', status: 'Submitted', templateName: 'Organizer' } }),
      ).not.toContain('resendLink');
    });

    it('opens the client when converted and the existing client when duplicate', () => {
      expect(actions({ status: 'Converted', customerId: 'customer-1', canCreateClient: true })).toEqual([
        'openRequest',
        'openClient',
      ]);
      expect(actions({ status: 'Duplicate', duplicateOfCustomerId: 'customer-2' })).toEqual([
        'openRequest',
        'viewClient',
      ]);
    });

    it('only offers Reopen (and the request) when lost', () => {
      expect(actions({ status: 'Lost', canCreateClient: true })).toEqual(['openRequest', 'reopen']);
    });

    it('drops send/resend without the permission or the office flag, and lost/reopen without the permission', () => {
      externalEnabled.set(false);
      expect(actions({})).toEqual(['openRequest', 'markLost']);
      externalEnabled.set(true);
      permissions.set(new Set(['tasks.form_requests.read']));
      expect(actions({})).toEqual(['openRequest']);
      expect(actions({ status: 'Lost' })).toEqual(['openRequest']);
    });

    it('has no Open request without a latest request', () => {
      expect(actions({ latestRequest: null, canCreateClient: true })).not.toContain('openRequest');
    });

    it('hides Create client without the request the server picked for it', () => {
      expect(actions({ status: 'Submitted', canCreateClient: true, createClientRequestId: null })).not.toContain(
        'createClient',
      );
    });
  });

  it('renders the row with name, email, status, source and the latest request', async () => {
    const fixture = render([prospect({ status: 'Submitted' })]);
    await settle(fixture);
    const row = (fixture.nativeElement as HTMLElement).querySelector('[data-prospect="participant-1"]')!;

    expect(prospects.list).toHaveBeenCalledWith({ status: null, search: null, page: 1, size: 25 });
    expect(row.textContent).toContain('Pat Prospect');
    expect(row.textContent).toContain('pat@example.com');
    expect(row.textContent).toContain('Submitted');
    expect(row.textContent).toContain('Sent by email');
    expect(row.textContent).toContain('Organizer 2026');
    expect(row.textContent).toContain('Pending');
  });

  it('shows the empty state for filters', async () => {
    const fixture = render([]);
    await settle(fixture);
    fixture.componentInstance.changeStatus('Lost');
    await settle(fixture);

    expect(prospects.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'Lost', page: 1 }));
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No prospects match');
  });

  it('lists the menu actions with labels when the trigger is clicked', async () => {
    const fixture = render([prospect({ status: 'Converted', customerId: 'customer-1' })]);
    await settle(fixture);
    const trigger = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[menuTrigger]')!;
    trigger.click();
    await settle(fixture);

    const labels = Array.from(document.body.querySelectorAll('[data-action]')).map((item) =>
      item.textContent?.trim(),
    );
    expect(labels).toEqual(['Open request', 'Open client']);
    (document.body.querySelector('[data-action="openClient"]') as HTMLButtonElement).click();
    expect(router.navigate).toHaveBeenCalledWith(['/clients', 'customer-1']);
  });

  it('opens the review drawer for the latest request', async () => {
    const fixture = render();
    await settle(fixture);
    fixture.componentInstance.run('openRequest', prospect());
    expect(requestsStore.open).toHaveBeenCalledWith('request-1');

    fixture.componentInstance.run('viewClient', prospect({ status: 'Duplicate', duplicateOfCustomerId: 'customer-2' }));
    expect(router.navigate).toHaveBeenCalledWith(['/clients', 'customer-2']);
  });

  it('starts the client creation on the request the server picked', async () => {
    const fixture = render();
    await settle(fixture);
    void fixture.componentInstance.createClient(
      prospect({ canCreateClient: true, createClientRequestId: 'request-7' }),
    );
    await Promise.resolve();

    expect(requests.startCustomerCreation).toHaveBeenCalledWith('request-7');
    expect(fixture.componentInstance.launchDone()).toBe('Client creation requested');
  });

  it('marks as lost with the optional reason after confirming', async () => {
    const fixture = render();
    await settle(fixture);
    prospects.markLost.mockReturnValue(of(prospect({ status: 'Lost', lostReason: 'No reply' })));
    const component = fixture.componentInstance;

    component.run('markLost', prospect());
    expect(component.lostTarget()?.participantId).toBe('participant-1');
    component.lostReason.set('No reply');
    await component.confirmLost();

    expect(prospects.markLost).toHaveBeenCalledWith('participant-1', 'No reply');
    expect(component.lostTarget()).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('Prospect marked as lost');
  });

  it('reopens a lost prospect', async () => {
    const fixture = render([prospect({ status: 'Lost' })]);
    await settle(fixture);
    prospects.reopen.mockReturnValue(of(prospect({ status: 'Submitted' })));

    await fixture.componentInstance.reopen(prospect({ status: 'Lost' }));

    expect(prospects.reopen).toHaveBeenCalledWith('participant-1');
    expect(toast.success).toHaveBeenCalledWith('Prospect reopened');
  });

  it('resends the link of the latest request after confirming', async () => {
    const fixture = render();
    await settle(fixture);
    const component = fixture.componentInstance;

    component.run('resendLink', prospect());
    expect(component.resendMessage()).toContain('to pat@example.com');
    await component.confirmResend();

    expect(requests.resendExternalAccess).toHaveBeenCalledWith('request-1');
    expect(component.resendTarget()).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('Access link resent');
  });

  it('opens the send dialog prefilled with the prospect', async () => {
    const fixture = render();
    await settle(fixture);
    const component = fixture.componentInstance;

    await component.openSend(prospect());

    expect(component.sendOpen()).toBe(true);
    expect(component.sendPrefill()).toEqual({ email: 'pat@example.com', fullName: 'Pat Prospect' });
    expect(requests.assignableTemplates).toHaveBeenCalled();
    expect(requests.entryNotices).toHaveBeenCalled();
  });
});
