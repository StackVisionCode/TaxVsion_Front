import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { PermissionInfo, RoleSummary } from './user-management.model';
import { RolesStore, notGrantableLabel, notGrantableReason } from './roles.store';
import { UserManagementService } from './user-management.service';

/**
 * B9 — el CRUD de roles. Caso 6 del Anexo C: crear "Junior preparer" (ve clientes, no los edita) y
 * asignarlo, sin Postman.
 */
describe('RolesStore', () => {
  const base = 'https://api.test/auth';

  function permission(overrides: Partial<PermissionInfo> & { code: string }): PermissionInfo {
    return {
      id: `id-${overrides.code}`,
      module: 'customers',
      description: overrides.code,
      isCustomerPortal: false,
      grantable: true,
      ...overrides,
    };
  }

  function role(overrides: Partial<RoleSummary> = {}): RoleSummary {
    return {
      id: 'role-1',
      name: 'Junior preparer',
      description: null,
      isSystem: false,
      isActive: true,
      permissionCodes: ['customers.view'],
      assignableActorTypes: ['TenantEmployee'],
      ...overrides,
    };
  }

  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        UserManagementService,
        RolesStore,
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `https://api.test${path}` } },
      ],
    });
    return { store: TestBed.inject(RolesStore), http: TestBed.inject(HttpTestingController) };
  }

  /** Responde a las dos llamadas que dispara `load()`. */
  function flushLoad(
    http: HttpTestingController,
    roles: RoleSummary[],
    catalog: PermissionInfo[] = [],
  ): void {
    http.expectOne(`${base}/roles`).flush(roles);
    http.expectOne(`${base}/permissions`).flush(catalog);
  }

  afterEach(() => TestBed.resetTestingModule());

  // ---------- Separar lo propio de lo integrado ----------

  it('separa los roles de la oficina de los integrados', () => {
    const { store, http } = setup();
    store.load();
    flushLoad(http, [role(), role({ id: 'sys', name: 'Employee', isSystem: true })]);

    expect(store.customRoles().map(r => r.id)).toEqual(['role-1']);
    expect(store.systemRoles().map(r => r.id)).toEqual(['sys']);
  });

  it('el catálogo del picker deja fuera los permisos del portal del cliente', () => {
    const { store, http } = setup();
    store.load();
    flushLoad(http, [], [permission({ code: 'customers.view' }), permission({ code: 'portal.x', isCustomerPortal: true })]);

    const codes = store.catalogByModule().flatMap(group => group.permissions.map(p => p.code));

    expect(codes).toEqual(['customers.view']);
  });

  it('si el catálogo falla, la lista de roles se ve igual', () => {
    const { store, http } = setup();
    store.load();
    http.expectOne(`${base}/roles`).flush([role()]);
    http.expectOne(`${base}/permissions`).flush('nope', { status: 403, statusText: 'Forbidden' });

    expect(store.customRoles().length).toBe(1);
    expect(store.error()).not.toBeNull();
  });

  // ---------- Guardar un rol son DOS llamadas ----------

  it('editar manda nombre y permisos por separado, y recarga al terminar', () => {
    const { store, http } = setup();
    // El catálogo hace falta para traducir código → id.
    store.load();
    flushLoad(http, [], [permission({ code: 'customers.view' })]);

    let done = false;
    store.update('role-1', 'Junior', 'desc', ['customers.view']).subscribe(() => (done = true));

    const nameCall = http.expectOne(`${base}/roles/role-1`);
    expect(nameCall.request.method).toBe('PUT');
    expect(nameCall.request.body).toEqual({ name: 'Junior', description: 'desc' });
    nameCall.flush(role());

    const permsCall = http.expectOne(`${base}/roles/role-1/permissions`);
    expect(permsCall.request.method).toBe('PUT');
    // El backend recibe IDS, no códigos. Lo contrario daba 400 `PermissionIds is required` —
    // lo encontró la QA de B10 contra la flota, porque el test viejo fijaba mi suposición.
    expect(permsCall.request.body).toEqual({ permissionIds: ['id-customers.view'] });
    permsCall.flush(null);

    expect(done).toBe(true);
    // El `load()` posterior deja la lista al día sin que la pantalla lo pida.
    flushLoad(http, [role()]);
  });

  it('si falla el nombre, no se tocan los permisos', () => {
    const { store, http } = setup();
    store.load();
    flushLoad(http, [], [permission({ code: 'customers.view' })]);

    let failed = false;
    store.update('role-1', '', null, ['customers.view']).subscribe({ error: () => (failed = true) });

    http.expectOne(`${base}/roles/role-1`).flush('bad', { status: 400, statusText: 'Bad Request' });

    expect(failed).toBe(true);
    expect(store.error()).not.toBeNull();
    http.expectNone(`${base}/roles/role-1/permissions`);
  });

  // ---------- Duplicar ----------

  it('duplicar copia solo los permisos que hoy se pueden conceder', () => {
    // Si el rol original tiene uno que el plan ya no habilita, copiarlo entero haría que el backend
    // rechace la copia completa — y el administrador se quedaría sin nada.
    const { store, http } = setup();
    store.load();
    flushLoad(
      http,
      [],
      [permission({ code: 'customers.view' }), permission({ code: 'campaigns.view', grantable: false })],
    );

    store.duplicate(role({ name: 'Senior', permissionCodes: ['customers.view', 'campaigns.view'] })).subscribe();

    const created = http.expectOne(`${base}/roles`);
    expect(created.request.body).toEqual({
      name: 'Senior (copy)',
      description: null,
      permissionIds: ['id-customers.view'],
    });
  });

  it('sin catálogo NO se guarda: mandaría el rol sin permisos', () => {
    // Sin el catálogo no hay forma de traducir los códigos a ids. Mandar la lista vacía dejaría el
    // rol sin nada, que es peor que fallar.
    const { store, http } = setup();
    store.load();
    http.expectOne(`${base}/roles`).flush([]);
    http.expectOne(`${base}/permissions`).flush('nope', { status: 403, statusText: 'Forbidden' });

    let failed = false;
    store.createFromCodes('Junior', null, ['customers.view']).subscribe({ error: () => (failed = true) });

    expect(failed).toBe(true);
    expect(store.error()).toContain('permission catalog');
    http.expectNone(`${base}/roles`);
  });

  it('avisa qué permisos se quedan afuera al duplicar', () => {
    const { store, http } = setup();
    store.load();
    flushLoad(http, [], [permission({ code: 'customers.view' }), permission({ code: 'campaigns.view', grantable: false })]);

    const dropped = store.droppedOnDuplicate(role({ permissionCodes: ['customers.view', 'campaigns.view'] }));

    expect(dropped).toEqual(['campaigns.view']);
  });

  // ---------- Quiénes tienen el rol ----------

  it('los usuarios de un rol se piden una sola vez', () => {
    const { store, http } = setup();
    store.loadUsers('role-1');
    http.expectOne(`${base}/roles/role-1/users`).flush([]);

    store.loadUsers('role-1');

    http.expectNone(`${base}/roles/role-1/users`);
    expect(store.usersOf('role-1')).toEqual([]);
  });
});

/**
 * El motivo por el que un permiso no se puede conceder. `grantable` lo decide el backend; las otras
 * banderas solo sirven para EXPLICARLO, y esa explicación es lo que separa "la aplicación está
 * rota" de "hay que subir de plan".
 */
describe('notGrantableReason', () => {
  function permission(overrides: Partial<PermissionInfo>): PermissionInfo {
    return {
      id: 'p',
      code: 'x.y',
      module: 'm',
      description: '',
      isCustomerPortal: false,
      ...overrides,
    };
  }

  it('sin la bandera del backend, se deja intentar', () => {
    // Un backend viejo no manda `grantable`. Suponer que no se puede escondería permisos válidos;
    // el servidor decide.
    expect(notGrantableReason(permission({}))).toBeNull();
  });

  it('grantable true = se puede', () => {
    expect(notGrantableReason(permission({ grantable: true }))).toBeNull();
  });

  it('distingue los motivos, en orden de precedencia', () => {
    expect(notGrantableReason(permission({ grantable: false, platformOnly: true }))).toBe('platform');
    expect(notGrantableReason(permission({ grantable: false, isDangerous: true }))).toBe('dangerous');
    expect(notGrantableReason(permission({ grantable: false, isReserved: true }))).toBe('reserved');
    expect(notGrantableReason(permission({ grantable: false, isAssignableByTenant: false }))).toBe('not_assignable');
    // Sin ninguna bandera estructural, lo que queda es el techo comercial.
    expect(notGrantableReason(permission({ grantable: false }))).toBe('plan');
  });

  it('cada motivo tiene un texto para el administrador', () => {
    for (const reason of ['platform', 'dangerous', 'reserved', 'not_assignable', 'plan'] as const) {
      expect(notGrantableLabel(reason).length).toBeGreaterThan(0);
    }
  });
});
