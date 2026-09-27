import { DestroyRef, Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { SubscriptionStatusStore } from '@core/billing/subscription-status.store';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { AccessStore } from './access.store';
import { AccessSyncService } from './access-sync.service';
import { AccessRequirement } from './features';

/**
 * B8 — la UI converge sola. Casos 1, 3 y 8 del Anexo C: un permiso que se quita en caliente, un
 * módulo que aparece al contratar el plan y uno que desaparece al perderlo.
 */
describe('AccessSyncService', () => {
  let accessChanged$: Subject<{ scope: 'user' | 'tenant'; permissionsVersion: number | null }>;
  let reconnected$: Subject<void>;
  let refreshed$: Subject<void>;
  let reloads: number;
  let conditionalLoads: number;
  let subscriptionLoads: number;
  let navigations: { path: string; feature: string }[];
  let toasts: string[];
  let currentUrl: string;
  let permissionsVersion: number | null;
  let available: boolean;
  let reason: 'plan' | 'permission';

  function setup() {
    accessChanged$ = new Subject();
    reconnected$ = new Subject();
    refreshed$ = new Subject();
    reloads = 0;
    conditionalLoads = 0;
    subscriptionLoads = 0;
    navigations = [];
    toasts = [];
    currentUrl = '/campaigns';
    permissionsVersion = 7;
    available = true;
    reason = 'permission';

    TestBed.configureTestingModule({
      providers: [
        AccessSyncService,
        {
          provide: AccessStore,
          useValue: {
            reload: () => {
              reloads++;
              return Promise.resolve();
            },
            load: () => {
              conditionalLoads++;
              return Promise.resolve();
            },
            permissionsVersion: () => permissionsVersion,
            stateOf: (_: AccessRequirement) => (available ? { available: true } : { available: false, reason }),
          },
        },
        { provide: AuthService, useValue: { refreshed$ } },
        {
          provide: CommunicationRealtimeService,
          useValue: { on: () => accessChanged$.asObservable(), reconnected$: reconnected$.asObservable() },
        },
        { provide: SubscriptionStatusStore, useValue: { load: () => subscriptionLoads++ } },
        {
          provide: Router,
          useValue: {
            get url() {
              return currentUrl;
            },
            navigate: (commands: unknown[], extras?: { queryParams?: { feature?: string } }) => {
              navigations.push({ path: String(commands[0]), feature: extras?.queryParams?.feature ?? '' });
              return Promise.resolve(true);
            },
          },
        },
        { provide: ToastService, useValue: { info: (m: string) => toasts.push(m), error: () => {}, success: () => {} } },
      ],
    });

    const injector = TestBed.inject(Injector);
    const service = TestBed.inject(AccessSyncService);
    runInInjectionContext(injector, () => service.start(TestBed.inject(DestroyRef)));
    return service;
  }

  /** Deja correr la microtarea del `.then()` del refresco. */
  const settle = () => Promise.resolve().then(() => undefined);

  afterEach(() => TestBed.resetTestingModule());

  // ---------- Los cuatro disparadores ----------

  it('un `access.changed` del tenant vuelve a pedir el bootstrap', async () => {
    setup();

    accessChanged$.next({ scope: 'tenant', permissionsVersion: null });
    await settle();

    expect(reloads).toBe(1);
  });

  it('reconectar el socket también', async () => {
    setup();

    reconnected$.next();
    await settle();

    expect(conditionalLoads).toBe(1);
  });

  it('renovar el token también (es lo que significa TokenStale)', async () => {
    setup();

    refreshed$.next();
    await settle();

    expect(conditionalLoads).toBe(1);
  });

  it('volver el foco a la pestaña también', async () => {
    setup();

    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(conditionalLoads).toBe(1);
  });

  // ---------- Eventos viejos ----------

  it('ignora un evento del usuario con un perm_v que ya tenemos', async () => {
    // El socket no garantiza el orden: un evento reordenado o duplicado no debe costar una petición.
    setup();

    accessChanged$.next({ scope: 'user', permissionsVersion: 7 });
    accessChanged$.next({ scope: 'user', permissionsVersion: 6 });
    await settle();

    expect(reloads).toBe(0);
  });

  it('atiende uno con perm_v nuevo', async () => {
    setup();

    accessChanged$.next({ scope: 'user', permissionsVersion: 8 });
    await settle();

    expect(reloads).toBe(1);
  });

  it('un evento del tenant nunca se descarta por perm_v', async () => {
    // Cambió el PLAN, no los permisos del usuario: su `perm_v` sigue igual y aun así hay que releer.
    setup();

    accessChanged$.next({ scope: 'tenant', permissionsVersion: null });
    await settle();

    expect(reloads).toBe(1);
  });

  // ---------- Caso 1 del Anexo C: perder el acceso estando en la pantalla ----------

  it('si pierde el permiso de la pantalla actual, sale a /forbidden con aviso', async () => {
    setup();
    available = false;
    reason = 'permission';

    accessChanged$.next({ scope: 'user', permissionsVersion: 8 });
    await settle();

    expect(navigations).toEqual([{ path: '/forbidden', feature: 'campaigns' }]);
    expect(toasts[0]).toContain('Campaigns');
  });

  it('si lo pierde por el plan, sale a /not-available', async () => {
    // Caso 8: la oficina pierde el entitlement. La salida es comercial, no "pedile acceso al admin".
    setup();
    available = false;
    reason = 'plan';

    accessChanged$.next({ scope: 'tenant', permissionsVersion: null });
    await settle();

    expect(navigations[0].path).toBe('/not-available');
    expect(toasts[0]).toContain('no longer part of your plan');
  });

  it('si conserva el acceso, no se lo mueve de donde está', async () => {
    // Caso 3 al revés: el refresco es silencioso mientras no cambie nada para el usuario.
    setup();

    accessChanged$.next({ scope: 'tenant', permissionsVersion: null });
    await settle();

    expect(navigations).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it('en una pantalla sin feature no se hace nada', async () => {
    setup();
    currentUrl = '/forbidden?feature=campaigns';
    available = false;

    accessChanged$.next({ scope: 'tenant', permissionsVersion: null });
    await settle();

    // Echar al usuario de la propia pantalla de aviso sería un bucle.
    expect(navigations).toEqual([]);
  });

  // ---------- El banner ----------

  it('cada refresco recarga el estado de la suscripción', async () => {
    setup();

    accessChanged$.next({ scope: 'tenant', permissionsVersion: null });
    await settle();

    expect(subscriptionLoads).toBe(1);
  });

  // ---------- Idempotencia ----------

  it('arrancar dos veces no duplica los listeners', async () => {
    const service = setup();
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => service.start(TestBed.inject(DestroyRef)));

    reconnected$.next();
    await settle();

    expect(conditionalLoads).toBe(1);
  });

  // ---------- B10: lo que encontró la QA en vivo ----------

  it('las comprobaciones rutinarias son CONDICIONALES (usan el ETag)', async () => {
    // Se vio en la flota local: cada comprobación bajaba las ~140 permissions enteras porque
    // `reload()` borra el ETag. El 304 sin cuerpo es justamente para lo que existe.
    setup();

    reconnected$.next();
    await settle();

    expect(conditionalLoads).toBe(1);
    expect(reloads).toBe(0);
  });

  it('`access.changed` SÍ fuerza la respuesta entera', async () => {
    // Ahí sabemos que algo cambió: el ETag viejo no sirve de nada.
    setup();

    accessChanged$.next({ scope: 'tenant', permissionsVersion: null });
    await settle();

    expect(reloads).toBe(1);
    expect(conditionalLoads).toBe(0);
  });

  it('dos disparadores rutinarios seguidos cuestan UNA petición', async () => {
    // Volver a la pestaña dispara `focus` Y `visibilitychange` en el mismo gesto.
    setup();

    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(conditionalLoads).toBe(1);
  });

  it('la ventana de silencio NO frena un `access.changed`', async () => {
    setup();
    window.dispatchEvent(new Event('focus'));
    await settle();

    accessChanged$.next({ scope: 'tenant', permissionsVersion: null });
    await settle();

    expect(reloads).toBe(1);
  });
});
