import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';
import { ApiConfigService } from '@core/config/api-config.service';
import { AccessBootstrap } from './access.model';
import { AccessStore } from './access.store';
import { FEATURES, featureByRoute } from './features';

/**
 * B2 — la fuente única. Los fixtures son los que pide la fase: empleado, administrador, módulo fuera
 * del plan y permiso denegado. El deny no es un caso aparte: desde A2 el backend manda los permisos
 * YA efectivos, así que un permiso quitado sencillamente no viene en la lista.
 */
describe('AccessStore', () => {
  const ACCESS_URL = 'https://api.test/auth/me/access';

  function bootstrap(overrides: Partial<AccessBootstrap> = {}): AccessBootstrap {
    return {
      actorType: 'TenantEmployee',
      effectivePermissions: ['customers.view', 'tasks.read'],
      modules: ['customers', 'planner'],
      permissionsVersion: 7,
      entitlementsRevision: 42,
      subscription: null,
      ...overrides,
    };
  }

  function setup(currentUser: { permissions: string[]; actorType: string } | null = null) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: () => ACCESS_URL } },
        { provide: AuthService, useValue: { currentUser: signal(currentUser) } },
      ],
    });
    return {
      store: TestBed.inject(AccessStore),
      http: TestBed.inject(HttpTestingController),
    };
  }

  function respond(http: HttpTestingController, body: AccessBootstrap): void {
    http.expectOne(ACCESS_URL).flush(body, { headers: { ETag: 'W/"abc"' } });
  }

  // ---------- Preguntas básicas ----------

  it('responde por los permisos efectivos del bootstrap', () => {
    const { store, http } = setup();
    store.load();
    respond(http, bootstrap());

    expect(store.can('customers.view')).toBe(true);
    expect(store.can('customers.manage')).toBe(false);
    expect(store.canAny(['customers.manage', 'tasks.read'])).toBe(true);
    expect(store.canAll(['customers.view', 'tasks.read'])).toBe(true);
    expect(store.canAll(['customers.view', 'customers.manage'])).toBe(false);
  });

  it('un permiso denegado sencillamente no está', () => {
    // El backend resuelve roles − denies antes de mandarlo. Si el store recompusiera la unión de
    // roles por su cuenta, le devolvería al usuario el permiso que un administrador le quitó.
    const { store, http } = setup();
    store.load();
    respond(http, bootstrap({ effectivePermissions: ['customers.view'] }));

    expect(store.can('tasks.read')).toBe(false);
  });

  it('distingue al administrador por actor type', () => {
    const { store, http } = setup();
    store.load();
    respond(http, bootstrap({ actorType: 'TenantAdmin' }));

    expect(store.isAdmin()).toBe(true);
    expect(store.actorType()).toBe('TenantAdmin');
  });

  // ---------- Módulos del plan ----------

  it('dice POR QUÉ una feature no está disponible', () => {
    const { store, http } = setup();
    store.load();
    // Tiene el permiso de tareas pero la oficina no contrató el módulo.
    respond(http, bootstrap({ effectivePermissions: ['customers.view', 'tasks.read'], modules: ['customers'] }));

    const tasks = featureByRoute('task')!;
    const clients = featureByRoute('clients')!;
    const chat = featureByRoute('chat')!;

    expect(store.stateOf(tasks)).toEqual({ available: false, reason: 'plan' });
    expect(store.stateOf(clients)).toEqual({ available: true });
    // Sin el permiso Y sin el módulo gana el plan: pedirle el permiso al administrador no serviría
    // de nada si la oficina no contrató el módulo.
    expect(store.stateOf(chat)).toEqual({ available: false, reason: 'plan' });
  });

  it('una feature transversal no depende del plan', () => {
    const { store, http } = setup();
    store.load();
    respond(http, bootstrap({ effectivePermissions: [], modules: [] }));

    expect(store.canUse(featureByRoute('dashboard')!)).toBe(true);
    expect(store.canUse(featureByRoute('profile')!)).toBe(true);
  });

  it('sin permiso pero con módulo, la razón es el permiso', () => {
    const { store, http } = setup();
    store.load();
    respond(http, bootstrap({ effectivePermissions: [], modules: ['customers'] }));

    expect(store.stateOf(featureByRoute('clients')!)).toEqual({ available: false, reason: 'permission' });
  });

  // ---------- Respaldo: el backend todavía sin A5 ----------

  it('sin bootstrap usa los permisos del perfil de sesión', () => {
    // Si un frontend nuevo exigiera un backend nuevo, el día del despliegue la UI entera se vaciaría.
    const { store } = setup({ permissions: ['customers.view'], actorType: 'TenantEmployee' });

    expect(store.loaded()).toBe(false);
    expect(store.can('customers.view')).toBe(true);
    expect(store.can('tasks.read')).toBe(false);
  });

  it('sin bootstrap no esconde nada por plan', () => {
    // "No sé qué módulos tiene el plan" no es lo mismo que "no tiene ninguno". Además el gate de
    // módulo del backend está en log-only: esconder acá sería más estricto que el servidor.
    const { store } = setup({ permissions: ['tasks.read'], actorType: 'TenantEmployee' });

    expect(store.moduleEnabled('planner')).toBe(true);
    expect(store.canUse(featureByRoute('task')!)).toBe(true);
  });

  it('un bootstrap que falla deja la aplicación usable', () => {
    const { store, http } = setup({ permissions: ['customers.view'], actorType: 'TenantEmployee' });
    store.load();
    http.expectOne(ACCESS_URL).flush('nope', { status: 403, statusText: 'Forbidden' });

    expect(store.loaded()).toBe(false);
    expect(store.can('customers.view')).toBe(true);
  });

  // ---------- ETag ----------

  it('manda If-None-Match en la segunda llamada', () => {
    const { store, http } = setup();
    store.load();
    respond(http, bootstrap());

    store.load();
    expect(http.expectOne(ACCESS_URL).request.headers.get('If-None-Match')).toBe('W/"abc"');
  });

  it('un 304 conserva lo que ya tenía', () => {
    const { store, http } = setup();
    store.load();
    respond(http, bootstrap());

    store.load();
    http.expectOne(ACCESS_URL).flush(null, { status: 304, statusText: 'Not Modified' });

    expect(store.can('customers.view')).toBe(true);
  });

  // ---------- El registro y el store hablan el mismo idioma ----------

  it('toda feature del registro se puede evaluar', () => {
    const { store, http } = setup();
    store.load();
    respond(http, bootstrap({ effectivePermissions: [], modules: [] }));

    for (const feature of FEATURES) {
      expect(() => store.stateOf(feature)).not.toThrow();
    }
  });
});
