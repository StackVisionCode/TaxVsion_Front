import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { seatSlotGatedCanActivateChild } from './seat-slot-gated.guard';
import { SeatSlotGatedStore } from './seat-slot-gated.store';

@Component({ selector: 'app-stub', template: 'stub', standalone: true })
class StubComponent {}

interface Options {
  gated?: boolean;
  isAdmin?: boolean;
}

/**
 * SG-8 — el guard global que impide navegar fuera de `/blocked/*` cuando el usuario está gated.
 * Owner (G-C4) y rutas exentas (G-C2) nunca se bloquean.
 */
describe('seatSlotGatedCanActivateChild', () => {
  function setup(options: Options): Router {
    const gatedState = options.gated ?? false;
    const admin = options.isAdmin ?? false;

    const routes: Routes = [
      {
        path: '',
        canActivateChild: [seatSlotGatedCanActivateChild],
        children: [
          { path: 'dashboard', component: StubComponent },
          { path: 'login', component: StubComponent },
          { path: 'auth/me', component: StubComponent },
          { path: 'auth/me/access', component: StubComponent },
          { path: 'blocked/seat-suspended', component: StubComponent },
        ],
      },
      { path: '**', component: StubComponent },
    ];

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        {
          provide: SeatSlotGatedStore,
          useValue: {
            isGated: () => gatedState,
            state: () => (gatedState ? { slotIndex: 11, effectiveCap: 10, contactAdminUrl: '' } : null),
            clear: () => undefined,
            setGatedState: () => undefined,
          },
        },
        {
          provide: AccessStore,
          useValue: {
            isAdmin: () => admin,
          },
        },
      ],
    });

    return TestBed.inject(Router);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('user gated navegando a /dashboard → redirige a /blocked/seat-suspended', async () => {
    const router = setup({ gated: true });

    await router.navigateByUrl('/dashboard');

    expect(router.url).toBe('/blocked/seat-suspended');
  });

  it('user gated ya en /blocked/* pasa (no re-redirige)', async () => {
    const router = setup({ gated: true });

    await router.navigateByUrl('/blocked/seat-suspended');

    expect(router.url).toBe('/blocked/seat-suspended');
  });

  it('G-C2: /login siempre pasa aunque esté gated', async () => {
    const router = setup({ gated: true });

    await router.navigateByUrl('/login');

    expect(router.url).toBe('/login');
  });

  it('G-C2: /auth/me y /auth/me/access siempre pasan', async () => {
    for (const target of ['/auth/me', '/auth/me/access']) {
      const router = setup({ gated: true });
      await router.navigateByUrl(target);
      expect(router.url).toBe(target);
      TestBed.resetTestingModule();
    }
  });

  it('G-C4: owner (TenantAdmin) gated no entra al desvío', async () => {
    // Caso borde: aunque el calculator no debería meter al owner en el gate, el cinturón barato lo
    // cuida igual. Verificar que el admin pasa aunque el store diga "gated".
    const router = setup({ gated: true, isAdmin: true });

    await router.navigateByUrl('/dashboard');

    expect(router.url).toBe('/dashboard');
  });

  it('sin bloqueo activo, el guard es un no-op', async () => {
    const router = setup({ gated: false });

    await router.navigateByUrl('/dashboard');

    expect(router.url).toBe('/dashboard');
  });
});
