import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { of, throwError } from 'rxjs';
import { ClientFormsAvailabilityStore } from '../../data-access/client-forms-availability.store';
import { FormRequestsService } from '../../data-access/form-requests.service';
import { FormRequestsStore } from '../../data-access/form-requests.store';
import { FormRequestsInboxComponent } from './form-requests-inbox.component';

describe('FormRequestsInboxComponent send to external email', () => {
  const store = { load: vi.fn(async () => undefined), loadStatusCounts: vi.fn(async () => undefined) };
  const service = { assignExternal: vi.fn(() => of({ id: 'request-9' })) };
  const router = { navigate: vi.fn() };
  const input = {
    email: 'pat@example.com',
    fullName: null,
    templateId: 'template-1',
    entryNoticeKey: 'identity_check',
    title: null,
    messageToClient: null,
    dueAtUtc: null,
    taxYear: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: FormRequestsStore, useValue: store },
        { provide: FormRequestsService, useValue: service },
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
    vi.useFakeTimers();
    const component = create();
    component.sendExternalOpen.set(true);
    component.activeStatus.set('Completed');
    component.search.set('ada');
    component.overdue.set(true);
    component.templateFilter.set('template-1');

    const run = component.sendExternal(input);
    await vi.runAllTimersAsync();
    await run;

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
    // La coreografía reemplaza al toast: el diálogo se cierra al sellar y todo vuelve a idle.
    expect(component.sendTarget()).toBe('pat@example.com');
    expect(component.sendExternalOpen()).toBe(false);
    expect(component.launch()).toBe('idle');
    vi.useRealTimers();
  });

  it('keeps the dialog open with the error and no stamp when sending fails', async () => {
    service.assignExternal.mockReturnValueOnce(throwError(() => new Error('nope')));
    const component = create();
    component.sendExternalOpen.set(true);

    await component.sendExternal(input);

    expect(component.sendExternalOpen()).toBe(true);
    expect(component.sendExternalError()).toBeTruthy();
    expect(component.launch()).toBe('idle');
    expect(store.load).not.toHaveBeenCalled();
  });

  it('opens the client profile with the assign dialog link', () => {
    const component = create();
    component.assignToClient({ customerId: 'customer-7', templateId: 'template-1' });

    expect(router.navigate).toHaveBeenCalledWith(['/clients', 'customer-7'], {
      queryParams: { tab: 'work', assignForm: '1', assignTemplateId: 'template-1' },
    });
  });
});

describe('FormRequestsInboxComponent rows', () => {
  const item = {
    id: 'request-1',
    displayName: 'Ada Lovelace',
    maskedEmail: 'a***@example.com',
    participant: { kind: 'External', customerId: null, participantId: 'participant-1' },
    templateName: 'Organizer',
    title: 'Organizer 2025',
    versionNumber: 1,
    receivedAtUtc: '2026-10-24T10:00:00',
    lastSubmittedAtUtc: null,
    requestedAtUtc: '2026-10-20T10:00:00',
    status: 'Submitted',
    isOverdue: false,
    latestSignatureStatus: undefined,
    actionRuns: [],
  };
  const store = {
    load: vi.fn(async () => undefined),
    loadStatusCounts: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    total: () => 1,
    loading: () => false,
    error: () => null,
    items: () => [item],
    filters: () => ({ page: 1, pageSize: 25 }),
    statusCounts: () => ({}),
    detail: () => null,
  };
  const router = { navigate: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [FormRequestsInboxComponent],
      providers: [
        { provide: FormRequestsStore, useValue: store },
        { provide: FormRequestsService, useValue: { assignableTemplates: () => of([]) } },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({})), snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        { provide: AccessStore, useValue: { can: () => true } },
        { provide: ClientFormsAvailabilityStore, useValue: { externalParticipantsEnabled: signal(true) } },
      ],
    });
    // Solo interesa la tabla: los hijos quedan como elementos sin definir (CUSTOM_ELEMENTS_SCHEMA).
    TestBed.overrideComponent(FormRequestsInboxComponent, { set: { imports: [] } });
  });

  it('opens a row from a keyboard-reachable button named after the request', async () => {
    const fixture = TestBed.createComponent(FormRequestsInboxComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const open = (fixture.nativeElement as HTMLElement).querySelector(
      'button[data-testid="open-request"]',
    ) as HTMLButtonElement;
    expect(open.getAttribute('aria-label')).toBe('Open Organizer from Ada Lovelace');
    open.click();

    expect(store.open).toHaveBeenCalledWith('request-1');
    expect(router.navigate).toHaveBeenCalledTimes(1);
  });
});
