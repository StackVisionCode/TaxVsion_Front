import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { PermissionInfo, RoleSummary } from '../../data-access/user-management.model';
import { RolesStore } from '../../data-access/roles.store';
import { UserManagementService } from '../../data-access/user-management.service';
import { RoleEditorDrawerComponent } from './role-editor-drawer.component';

/**
 * B9 — el caso 6 del Anexo C de punta a punta en la pantalla: armar "Junior preparer" (ve clientes,
 * no los edita) sin Postman, con el picker diciendo por qué lo que no se puede elegir no se puede.
 */
describe('RoleEditorDrawerComponent', () => {
  const base = 'https://api.test/auth';

  const CATALOG: PermissionInfo[] = [
    { id: 'p1', code: 'customers.view', module: 'customers', description: 'See clients', isCustomerPortal: false, grantable: true },
    { id: 'p2', code: 'customers.manage', module: 'customers', description: 'Edit clients', isCustomerPortal: false, grantable: true },
    { id: 'p3', code: 'billing.view', module: 'billing', description: 'See billing', isCustomerPortal: false, grantable: false, isDangerous: true },
    { id: 'p4', code: 'campaigns.view', module: 'campaigns', description: 'See campaigns', isCustomerPortal: false, grantable: false },
    { id: 'p5', code: 'portal.only', module: 'portal', description: 'Portal thing', isCustomerPortal: true, grantable: true },
  ];

  function render(role: RoleSummary | null = null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RoleEditorDrawerComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        UserManagementService,
        RolesStore,
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `https://api.test${path}` } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(RolesStore);
    store.load();
    http.expectOne(`${base}/roles`).flush([]);
    http.expectOne(`${base}/permissions`).flush(CATALOG);

    const fixture = TestBed.createComponent(RoleEditorDrawerComponent);
    fixture.componentInstance.role = role;
    fixture.detectChanges();
    return { fixture, http, component: fixture.componentInstance };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('el picker no ofrece permisos del portal del cliente en un rol de staff', () => {
    const { fixture } = render();

    expect(document.body.textContent).not.toContain('Portal thing');
  });

  it('lo que no se puede conceder se ve, pero apagado y CON el motivo', () => {
    // Esconderlo sería peor: el administrador que busca "billing.view" y no lo encuentra cree que
    // la aplicación está rota.
    const { fixture, component } = render();
    const text = document.body.textContent as string;

    expect(text).toContain('See billing');
    expect(component.blockedReason(CATALOG[2])).toBe('High risk — only the owner role can hold it');
    expect(component.blockedReason(CATALOG[3])).toBe('Not included in your plan');
    expect(component.blockedReason(CATALOG[0])).toBeNull();
  });

  it('un permiso bloqueado no se puede marcar', () => {
    const { component } = render();

    component.toggle(CATALOG[2]);

    expect(component.isSelected('billing.view')).toBe(false);
  });

  it('crear el rol manda solo lo elegido', () => {
    const { component, http } = render();
    component.name.set('Junior preparer');
    component.toggle(CATALOG[0]);

    component.save();

    const created = http.expectOne(`${base}/roles`);
    // Ids, no códigos: es lo que exige `CreateRoleRequest.PermissionIds`.
    expect(created.request.body).toEqual({
      name: 'Junior preparer',
      description: null,
      permissionIds: ['p1'],
    });
  });

  it('sin nombre no se guarda', () => {
    const { component } = render();
    component.toggle(CATALOG[0]);

    expect(component.canSave()).toBe(false);
  });

  // ---------- Un rol que ya tenía algo que hoy no se concedería ----------

  it('un permiso ya concedido que hoy no sería concedible se puede QUITAR', () => {
    // El plan cambió después de crear el rol. Dejarlo bloqueado atraparía al administrador: vería
    // el permiso marcado y no podría sacarlo.
    const { component } = render({
      id: 'r1',
      name: 'Senior',
      description: null,
      isSystem: false,
      isActive: true,
      permissionCodes: ['campaigns.view'],
      assignableActorTypes: ['TenantEmployee'],
    });

    expect(component.isSelected('campaigns.view')).toBe(true);
    expect(component.isLocked(CATALOG[3])).toBe(false);

    component.toggle(CATALOG[3]);

    expect(component.isSelected('campaigns.view')).toBe(false);
    // Una vez quitado, ya no se puede volver a poner.
    expect(component.isLocked(CATALOG[3])).toBe(true);
  });

  // ---------- Roles integrados ----------

  it('un rol de sistema se abre en solo lectura', () => {
    const { component } = render({
      id: 'sys',
      name: 'Employee',
      description: null,
      isSystem: true,
      isActive: true,
      permissionCodes: ['customers.view'],
      assignableActorTypes: ['TenantEmployee'],
    });

    expect(component.readOnly()).toBe(true);
    expect(component.canSave()).toBe(false);

    component.toggle(CATALOG[1]);
    expect(component.isSelected('customers.manage')).toBe(false);
  });
});
