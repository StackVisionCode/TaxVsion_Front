import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { ClientFormsAvailabilityStore } from '../../data-access/client-forms-availability.store';
import { FormTemplatesStore } from '../../data-access/form-templates.store';
import { ClientFormsHomeComponent } from './client-forms-home.component';

describe('ClientFormsHomeComponent tabs', () => {
  const actorType = signal<string | null>('TenantAdmin');
  const permissions = signal(new Set<string>());

  beforeEach(() => {
    actorType.set('TenantAdmin');
    permissions.set(
      new Set([
        'tasks.form_requests.read',
        'tasks.form_templates.read',
        'tasks.form_intake_links.manage',
      ]),
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: FormTemplatesStore, useValue: {} },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        { provide: ClientFormsAvailabilityStore, useValue: {} },
        {
          provide: AccessStore,
          useValue: {
            can: (permission: string) => permissions().has(permission),
            isAdmin: () => actorType() === 'TenantAdmin' || actorType() === 'PlatformAdmin',
          },
        },
      ],
    });
  });

  const tabIds = () =>
    TestBed.runInInjectionContext(() => new ClientFormsHomeComponent())
      .tabs()
      .map((tab) => tab.id);

  it('shows Intake links to a tenant admin with the permission', () => {
    expect(tabIds()).toEqual(['requests', 'insights', 'prospects', 'templates', 'library', 'intake']);
  });

  it('shows Intake links to a platform admin with the permission', () => {
    actorType.set('PlatformAdmin');
    expect(tabIds()).toContain('intake');
  });

  // El controller rechaza a TenantEmployee aunque tenga el permiso.
  it('hides Intake links from an employee even with the permission', () => {
    actorType.set('TenantEmployee');
    expect(tabIds()).not.toContain('intake');
  });

  it('hides Intake links from an admin without the permission', () => {
    permissions.set(new Set(['tasks.form_requests.read']));
    expect(tabIds()).toEqual(['requests', 'insights', 'prospects']);
  });
});

describe('ClientFormsHomeComponent publish return link', () => {
  function setup(query: Record<string, string>) {
    const navigate = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: FormTemplatesStore, useValue: { load: vi.fn(async () => undefined) } },
        { provide: Router, useValue: { navigate } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        {
          provide: ClientFormsAvailabilityStore,
          useValue: { load: vi.fn(async () => ({ enabled: true, reason: null })) },
        },
        { provide: AccessStore, useValue: { can: () => true, isAdmin: () => false } },
      ],
    });
    const component = TestBed.runInInjectionContext(() => new ClientFormsHomeComponent());
    return { component, navigate };
  }

  it('opens Templates, highlights the published template and clears the link', async () => {
    const { component, navigate } = setup({ tab: 'templates', published: 'template-1' });

    await component.ngOnInit();

    expect(component.activeTab()).toBe('templates');
    expect(component.publishedId()).toBe('template-1');
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { tab: null, published: null }, replaceUrl: true }),
    );
  });

  it('opens Prospects from the link for a user who can read requests', async () => {
    const { component } = setup({ tab: 'prospects' });

    await component.ngOnInit();

    expect(component.activeTab()).toBe('prospects');
  });

  it('opens Insights from the link for a user who can read requests', async () => {
    const { component } = setup({ tab: 'insights' });

    await component.ngOnInit();

    expect(component.activeTab()).toBe('insights');
  });

  it('falls back to the first tab when the link names one the user cannot see', async () => {
    const { component } = setup({ tab: 'intake' });

    await component.ngOnInit();

    expect(component.activeTab()).toBe('requests');
  });
});
