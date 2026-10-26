import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import { of } from 'rxjs';
import { ClientFormsAvailabilityStore } from '../../data-access/client-forms-availability.store';
import { FormRequestsService } from '../../data-access/form-requests.service';
import { FormRequestsStore } from '../../data-access/form-requests.store';
import { FormRequestsInboxComponent } from './form-requests-inbox.component';

describe('FormRequestsInboxComponent send to external email', () => {
  const store = { load: vi.fn(async () => undefined), loadStatusCounts: vi.fn(async () => undefined) };
  const service = { assignExternal: vi.fn(() => of({ id: 'request-9' })) };
  const toast = { success: vi.fn() };
  const router = { navigate: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: FormRequestsStore, useValue: store },
        { provide: FormRequestsService, useValue: service },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({})), snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        { provide: AccessStore, useValue: { can: () => true } },
        { provide: ClientFormsAvailabilityStore, useValue: { externalParticipantsEnabled: signal(true) } },
      ],
    });
  });

  const create = () => TestBed.runInInjectionContext(() => new FormRequestsInboxComponent());

  it('switches to External with every filter cleared so the new request is visible', async () => {
    const component = create();
    component.activeStatus.set('Completed');
    component.search.set('ada');
    component.overdue.set(true);
    component.templateFilter.set('template-1');

    await component.sendExternal({
      email: 'pat@example.com',
      fullName: null,
      templateId: 'template-1',
      entryNoticeKey: 'identity_check',
      title: null,
      messageToClient: null,
      dueAtUtc: null,
      taxYear: null,
    });

    expect(component.activeView()).toBe('External');
    expect(component.activeStatus()).toBe('All');
    expect(component.search()).toBe('');
    expect(component.overdue()).toBe(false);
    expect(component.templateFilter()).toBe('');
    expect(store.load).toHaveBeenCalledWith({
      view: 'External',
      page: 1,
      statuses: undefined,
      templateId: undefined,
      search: undefined,
      overdue: undefined,
    });
    expect(toast.success).toHaveBeenCalledWith('Form sent to pat@example.com');
  });

  it('opens the client profile with the assign dialog link', () => {
    const component = create();
    component.assignToClient({ customerId: 'customer-7', templateId: 'template-1' });

    expect(router.navigate).toHaveBeenCalledWith(['/clients', 'customer-7'], {
      queryParams: { tab: 'work', assignForm: '1', assignTemplateId: 'template-1' },
    });
  });
});
