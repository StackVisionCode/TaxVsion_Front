import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ClientFormsStore } from '../../data-access/client-forms.store';
import { ClientProfileFormsComponent } from './client-profile-forms.component';

describe('ClientProfileFormsComponent assign deep link', () => {
  const router = { navigate: vi.fn() };
  const store = { load: vi.fn(async () => undefined), open: vi.fn() };
  let permissions: Set<string>;

  function setup(query: Record<string, string>): ClientProfileFormsComponent {
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: AccessStore, useValue: { can: (permission: string) => permissions.has(permission) } },
        { provide: ToastService, useValue: { success: vi.fn() } },
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
});
