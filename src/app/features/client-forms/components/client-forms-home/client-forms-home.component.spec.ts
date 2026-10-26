import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
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
    expect(tabIds()).toEqual(['requests', 'templates', 'library', 'intake']);
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
    expect(tabIds()).toEqual(['requests']);
  });
});
