import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { PermissionInfo, RoleSummary, RoleUser } from '../../data-access/user-management.model';
import { UserManagementService } from '../../data-access/user-management.service';
import { RolesStore } from '../../data-access/roles.store';
import { RolesPanelComponent } from './roles-panel.component';
import { moduleLabel, roleInitials, roleTone } from './role-visuals';

describe('RolesPanelComponent', () => {
  const base = 'https://api.test/auth';

  const CATALOG: PermissionInfo[] = [
    { id: 'p1', code: 'customers.view', module: 'customers', description: 'See clients', isCustomerPortal: false, grantable: true },
    { id: 'p2', code: 'customers.manage', module: 'customers', description: 'Edit clients', isCustomerPortal: false, grantable: true },
    { id: 'p3', code: 'client_forms.view', module: 'client_forms', description: 'See forms', isCustomerPortal: false, grantable: true },
    { id: 'p4', code: 'tasks.view', module: 'tasks', description: 'See tasks', isCustomerPortal: false, grantable: true },
    { id: 'p5', code: 'sms.send', module: 'sms', description: 'Send SMS', isCustomerPortal: false, grantable: true },
  ];

  const role = (overrides: Partial<RoleSummary>): RoleSummary => ({
    id: 'r1',
    name: 'Junior preparer',
    description: 'Sees clients',
    isSystem: false,
    isActive: true,
    permissionCodes: [],
    assignableActorTypes: ['TenantEmployee'],
    ...overrides,
  });

  const ROLES: RoleSummary[] = [
    role({ id: 'junior', name: 'Junior preparer', permissionCodes: ['customers.view', 'customers.manage', 'client_forms.view', 'tasks.view', 'sms.send'] }),
    role({ id: 'sms', name: 'SMS Operator (copy)', description: 'Old test role', isActive: false, permissionCodes: ['sms.send'] }),
    role({ id: 'emp', name: 'Employee', description: null, isSystem: true, permissionCodes: ['customers.view'] }),
  ];

  const people = (count: number): RoleUser[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `u${i}`,
      name: `Person${i}`,
      lastName: 'Test',
      email: `p${i}@office.test`,
      actorType: 'TenantEmployee',
      isActive: true,
    }));

  function render() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RolesPanelComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        UserManagementService,
        RolesStore,
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `https://api.test${path}` } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(RolesPanelComponent);
    fixture.detectChanges();
    http.expectOne(`${base}/roles`).flush(ROLES);
    http.expectOne(`${base}/permissions`).flush(CATALOG);
    fixture.detectChanges();
    // Las caras de cada tarjeta: una petición por rol.
    http.expectOne(`${base}/roles/junior/users`).flush(people(6));
    http.expectOne(`${base}/roles/sms/users`).flush([]);
    http.expectOne(`${base}/roles/emp/users`).flush(people(1));
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, http };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('separa los activos, los inactivos (plegados) y los integrados', () => {
    const { component, fixture } = render();

    expect(component.activeRoles().map(r => r.id)).toEqual(['junior']);
    expect(component.inactiveRoles().map(r => r.id)).toEqual(['sms']);
    expect(component.systemRoles().map(r => r.id)).toEqual(['emp']);
    expect(component.inactiveOpen()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="role-inactive"]')).toBeNull();

    component.showInactive.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="role-inactive"]')).not.toBeNull();
  });

  it('dice qué áreas cubre el rol, de la que más tiene a la que menos, y resume el resto', () => {
    const { component } = render();
    const junior = component.activeRoles()[0];

    expect(component.areasPreview(junior)).toEqual(['Customers', 'Client forms', 'Tasks']);
    expect(component.moreAreas(junior)).toBe(1);
  });

  it('muestra hasta cuatro caras y cuántas personas tienen el rol', () => {
    const { component } = render();

    expect(component.peoplePreview('junior').length).toBe(4);
    expect(component.morePeople('junior')).toBe(2);
    expect(component.peopleLabel('junior')).toBe('6 people');
    expect(component.peopleLabel('emp')).toBe('1 person');
    expect(component.peopleLabel('sms')).toBe('Nobody yet');
  });

  it('la tarjeta no cuenta a quien ya no está activo, pero la lista lo muestra al final', () => {
    const { component } = render();
    const users = component.usersOf('junior')!.map((user, i) => ({ ...user, isActive: i !== 0 }));

    expect(component.sortedUsers(users)[users.length - 1].isActive).toBe(false);
  });

  it('el buscador filtra por nombre o descripción y abre los inactivos que coinciden', () => {
    const { component, fixture } = render();

    fixture.componentRef.setInput('search', 'old test');
    expect(component.activeRoles()).toEqual([]);
    expect(component.inactiveRoles().map(r => r.id)).toEqual(['sms']);
    expect(component.inactiveOpen()).toBe(true);

    fixture.componentRef.setInput('search', 'nothing like this');
    expect(component.nothingMatches()).toBe(true);
  });

  it('el color del rol es el mismo para el mismo nombre (tabla y tarjeta)', () => {
    expect(roleTone('ImportClients')).toBe(roleTone('ImportClients'));
    expect(roleInitials('ImportClients')).toBe('IC');
    expect(roleInitials('SMS Operator E2E (copy 2)')).toBe('SO');
    expect(moduleLabel('client_forms')).toBe('Client forms');
  });
});
