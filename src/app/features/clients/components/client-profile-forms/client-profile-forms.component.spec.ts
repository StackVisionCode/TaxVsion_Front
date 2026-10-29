import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import type { ClientFormRequestRow } from '../../data-access/client-forms.model';
import { ClientFormsStore } from '../../data-access/client-forms.store';
import { ClientProfileFormsComponent } from './client-profile-forms.component';

function row(id: string, status: ClientFormRequestRow['status'] = 'Pending'): ClientFormRequestRow {
  return { id, status } as ClientFormRequestRow;
}

describe('ClientProfileFormsComponent assign deep link', () => {
  const router = { navigate: vi.fn() };
  const items = signal<ClientFormRequestRow[]>([]);
  // Lo que lee la plantilla (con timers falsos se llega a renderizar).
  const store = {
    load: vi.fn(async () => undefined),
    open: vi.fn(),
    assign: vi.fn(async () => true),
    items,
    loading: signal(false),
    error: signal<string | null>(null),
    templates: signal([]),
    busy: signal(false),
    actionError: signal<string | null>(null),
    detail: signal(null),
    revision: signal(null),
    previousRevision: signal(null),
  };
  const toast = { error: vi.fn() };
  let permissions: Set<string>;

  function setup(query: Record<string, string>): ClientProfileFormsComponent {
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: AccessStore, useValue: { can: (permission: string) => permissions.has(permission) } },
        { provide: ToastService, useValue: toast },
      ],
    });
    TestBed.overrideComponent(ClientProfileFormsComponent, {
      set: { providers: [{ provide: ClientFormsStore, useValue: store }] },
    });
    const component = TestBed.createComponent(ClientProfileFormsComponent).componentInstance;
    component.clientId = 'customer-7';
    return component;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    items.set([]);
    store.detail.set(null);
    store.actionError.set(null);
    permissions = new Set(['tasks.form_requests.read', 'tasks.form_requests.manage']);
  });

  it('opens the assign dialog with the template from the link and clears the URL', async () => {
    const component = setup({ assignForm: '1', assignTemplateId: 'template-1' });

    await component.ngOnChanges();

    expect(component.assignOpen()).toBe(true);
    expect(component.initialTemplateId()).toBe('template-1');
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { assignForm: null, assignTemplateId: null },
        replaceUrl: true,
      }),
    );
  });

  it('does not open the dialog without manage permission', async () => {
    permissions = new Set(['tasks.form_requests.read']);
    const component = setup({ assignForm: '1' });

    await component.ngOnChanges();

    expect(component.assignOpen()).toBe(false);
  });

  it('ignores a profile visit without the link', async () => {
    const component = setup({});

    await component.ngOnChanges();

    expect(component.assignOpen()).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('clears the assign link when the user cannot read client forms', async () => {
    permissions = new Set();
    const component = setup({ assignForm: '1' });

    await component.ngOnChanges();

    expect(component.assignOpen()).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { assignForm: null, assignTemplateId: null } }),
    );
  });

  it('forgets the initial template when the dialog closes', async () => {
    const component = setup({ assignForm: '1', assignTemplateId: 'template-1' });
    await component.ngOnChanges();

    component.closeAssign();

    expect(component.assignOpen()).toBe(false);
    expect(component.initialTemplateId()).toBeNull();
  });

  it('pages the loaded requests on the client and counts the ones to review', () => {
    items.set([
      row('1', 'Submitted'),
      row('2'),
      row('3', 'Submitted'),
      row('4'),
      row('5'),
      row('6'),
      row('7', 'Completed'),
    ]);
    const component = setup({});

    expect(component.pagedItems().map(item => item.id)).toEqual(['1', '2', '3', '4', '5', '6']);
    component.page.set(2);
    expect(component.pagedItems().map(item => item.id)).toEqual(['7']);
    expect(component.toReview()).toBe(2);
  });

  it('closes the dialog under the overlay and goes back to page 1 when the assignment lands', async () => {
    vi.useFakeTimers();
    const component = setup({});
    component.assignOpen.set(true);
    component.page.set(3);

    const run = component.assign({} as never);
    await vi.runAllTimersAsync();
    await run;

    expect(store.assign).toHaveBeenCalled();
    expect(component.assignOpen()).toBe(false);
    expect(component.page()).toBe(1);
    expect(component.launch()).toBe('idle');
    vi.useRealTimers();
  });

  it('tells the user when a request cannot be opened (the drawer stays closed)', async () => {
    store.open.mockImplementationOnce(async () => {
      store.actionError.set('Request not found.');
    });
    const component = setup({});

    component.open('request-404');
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Request not found.'));
    expect(component.opening()).toBe(false);
  });

  it('keeps the dialog open (with its error) when the assignment fails', async () => {
    store.assign.mockResolvedValueOnce(false);
    const component = setup({});
    component.assignOpen.set(true);

    await component.assign({} as never);

    expect(component.assignOpen()).toBe(true);
    expect(component.launch()).toBe('idle');
  });
});
