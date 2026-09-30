import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter } from '@angular/router';
import { TokenService } from '@core/auth/token.service';
import { AccessStore } from './access.store';
import { FEATURES } from './features';
import { accessCanMatch } from './access.guard';

@Component({ selector: 'app-stub', template: 'stub' })
class StubComponent {}

/**
 * B4 — el caso 7 del Anexo C: escribir `/campaigns` a mano no debe entrar. Se prueba con un router
 * REAL sobre una tabla chica: lo que importa no es que la tabla sea la de producción (de eso se
 * encarga `app.routes.spec.ts`), sino que el guard decida bien y que el chunk ni se descargue.
 */
describe('accessCanMatch', () => {
  /** Registra si el router llegó a pedir el chunk perezoso de la ruta. */
  let chunkLoaded = false;

  interface Options {
    permissions?: readonly string[];
    modules?: readonly string[] | null;
    authenticated?: boolean;
    bootstrapDelayMs?: number;
    routePath?: string;
    featureId?: string;
  }

  function setup(options: Options): Router {
    chunkLoaded = false;
    const permissions = new Set(options.permissions ?? []);
    const modules = options.modules === undefined ? null : options.modules;
    let resolved = options.bootstrapDelayMs === undefined;

    const store = {
      ready: () =>
        resolved
          ? Promise.resolve()
          : new Promise<void>(resolve =>
              setTimeout(() => {
                resolved = true;
                resolve();
              }, options.bootstrapDelayMs),
            ),
      stateOf: (feature: { module: string | null; anyOf: readonly string[] }) => {
        // Hasta que el bootstrap no contesta, el store no sabe nada: cero permisos. Es justo el
        // estado en el que una recarga dura echaba al usuario.
        if (!resolved) {
          return { available: false, reason: 'permission' as const };
        }
        if (feature.module !== null && modules !== null && !modules.includes(feature.module)) {
          return { available: false, reason: 'plan' as const };
        }
        const granted = feature.anyOf.length === 0 || feature.anyOf.some(code => permissions.has(code));
        return granted ? { available: true as const } : { available: false, reason: 'permission' as const };
      },
    };

    const routes: Routes = [
      {
        path: options.routePath ?? 'campaigns',
        data: { feature: options.featureId ?? 'campaigns' },
        canMatch: [accessCanMatch],
        loadChildren: () => {
          chunkLoaded = true;
          return Promise.resolve([{ path: '', component: StubComponent }] as Routes);
        },
      },
      { path: 'dashboard', component: StubComponent },
      { path: 'forbidden', component: StubComponent },
      { path: 'not-available', component: StubComponent },
      { path: '**', component: StubComponent },
    ];

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: AccessStore, useValue: store },
        { provide: TokenService, useValue: { isAuthenticated: () => options.authenticated ?? true } },
      ],
    });

    return TestBed.inject(Router);
  }

  afterEach(() => TestBed.resetTestingModule());

  // ---------- Caso 7 del Anexo C ----------

  it('con permiso y módulo, la URL directa entra', async () => {
    const router = setup({ permissions: ['campaigns.manage'], modules: ['campaigns'] });

    await router.navigateByUrl('/campaigns');

    expect(router.url).toBe('/campaigns');
    expect(chunkLoaded).toBe(true);
  });

  it('sin el permiso, la URL directa termina en /forbidden', async () => {
    const router = setup({ permissions: [], modules: ['campaigns'] });

    await router.navigateByUrl('/campaigns');

    expect(router.url).toContain('/forbidden');
    expect(router.url).toContain('feature=campaigns');
  });

  it('sin el módulo del plan, termina en /not-available', async () => {
    // Tiene el permiso; lo que falta es que la oficina haya contratado el módulo. Mandarlo a
    // "pedile acceso al administrador" sería mandarlo a pedir lo que no soluciona nada.
    const router = setup({ permissions: ['campaigns.manage'], modules: [] });

    await router.navigateByUrl('/campaigns');

    expect(router.url).toContain('/not-available');
  });

  it('el chunk perezoso NI SE DESCARGA cuando el guard dice que no', async () => {
    // Es la otra mitad del valor de `canMatch`: además de no pintar la pantalla, no se baja el
    // código de una sección que el usuario no puede usar.
    const router = setup({ permissions: [], modules: ['campaigns'] });

    await router.navigateByUrl('/campaigns');

    expect(chunkLoaded).toBe(false);
  });

  it('guarda la URL intentada para poder volver a ella', async () => {
    const router = setup({ permissions: [], modules: ['campaigns'] });

    await router.navigateByUrl('/campaigns');

    expect(decodeURIComponent(router.url)).toContain('from=/campaigns');
  });

  // ---------- La carrera con el bootstrap ----------

  it('espera el bootstrap antes de decidir', async () => {
    // Sin la espera, la recarga dura de `/campaigns` se evalúa con cero permisos en mano y echa a
    // quien sí tenía acceso. El fixture arranca sin contestar y contesta a los 10 ms.
    const router = setup({
      permissions: ['campaigns.manage'],
      modules: ['campaigns'],
      bootstrapDelayMs: 10,
    });

    await router.navigateByUrl('/campaigns');

    expect(router.url).toBe('/campaigns');
  });

  // ---------- Lo que NO le toca al guard ----------

  it('sin sesión no decide: deja pasar para que el authGuard mande al login', async () => {
    const router = setup({ permissions: [], modules: [], authenticated: false });

    await router.navigateByUrl('/campaigns');

    expect(router.url).toBe('/campaigns');
  });

  it('una ruta sin feature declarada no se gatea', async () => {
    const router = setup({ permissions: [], modules: [] });

    await router.navigateByUrl('/dashboard');

    expect(router.url).toBe('/dashboard');
  });

  // ---------- Cada feature del registro, en sus tres estados ----------

  it('cada feature gateada entra con lo suyo y rebota sin ello', async () => {
    for (const feature of FEATURES) {
      const path = 'gated';
      const withModule = feature.module ? [feature.module] : [];

      // 1) Con su permiso y su módulo: entra.
      let router = setup({
        permissions: feature.anyOf,
        modules: withModule,
        routePath: path,
        featureId: feature.id,
      });
      await router.navigateByUrl('/' + path);
      expect(router.url, feature.id + ' debería entrar con su permiso y su módulo').toBe('/' + path);
      TestBed.resetTestingModule();

      // 2) Sin el permiso: /forbidden (solo si es el permiso lo que la gatea).
      if (feature.anyOf.length > 0) {
        router = setup({ permissions: [], modules: withModule, routePath: path, featureId: feature.id });
        await router.navigateByUrl('/' + path);
        expect(router.url, feature.id + ' sin permiso').toContain('/forbidden');
        TestBed.resetTestingModule();
      }

      // 3) Sin el módulo del plan: /not-available. Gana sobre el permiso a propósito.
      if (feature.module !== null) {
        router = setup({ permissions: feature.anyOf, modules: [], routePath: path, featureId: feature.id });
        await router.navigateByUrl('/' + path);
        expect(router.url, feature.id + ' sin módulo').toContain('/not-available');
        TestBed.resetTestingModule();
      }
    }
  });
});
