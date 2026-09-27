import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { ToastService } from '@shared/ui/toast/toast.service';
import { AccessStore } from './access.store';
import { EntitlementsNoticeService } from './entitlements-notice.service';

/**
 * B7 — la reacción al `403 Authz.ModuleUnavailable`. Caso 2 del Anexo C: el plan Standard no
 * incluye Client communication.
 *
 * Ese 403 dice dos cosas: que la salida es comercial (no "pedile acceso al administrador") y que
 * nuestra lista de módulos quedó vieja.
 */
describe('EntitlementsNoticeService', () => {
  let reloads: number;
  let toasts: string[];
  let canManageBilling: ReturnType<typeof signal<boolean>>;

  function setup() {
    reloads = 0;
    toasts = [];
    canManageBilling = signal(false);

    TestBed.configureTestingModule({
      providers: [
        EntitlementsNoticeService,
        {
          provide: AccessStore,
          useValue: {
            reload: () => {
              reloads++;
              return Promise.resolve();
            },
            canManageBilling: computed(() => canManageBilling()),
          },
        },
        { provide: ToastService, useValue: { info: (m: string) => toasts.push(m), error: () => {}, success: () => {} } },
      ],
    });
    return TestBed.inject(EntitlementsNoticeService);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('vuelve a pedir el bootstrap: el servidor sabe algo que nosotros no', () => {
    const service = setup();

    service.notify('comms');

    expect(reloads).toBe(1);
  });

  it('a quien puede contratar le dice dónde hacerlo', () => {
    const service = setup();
    canManageBilling.set(true);

    service.notify('comms');

    expect(toasts[0]).toBe('Client communication is not in your plan. Open Manage subscription to add it.');
  });

  it('a quien NO puede contratar le dice a quién pedírselo', () => {
    // Decirle a un empleado "upgrade your plan" es mandarlo a una puerta que no puede abrir.
    const service = setup();

    service.notify('comms');

    expect(toasts[0]).toBe('Client communication is not in your plan. Ask whoever manages billing in your office.');
    expect(toasts[0]).not.toContain('Manage subscription');
  });

  it('sin nombre de módulo avisa igual, en genérico', () => {
    const service = setup();

    service.notify(null);

    expect(toasts[0]).toContain('That section is not in your plan');
    expect(reloads).toBe(1);
  });

  it('no repite el aviso del mismo módulo', () => {
    // Una pantalla dispara varias peticiones y todas fallan igual: seis toasts y seis recargas por
    // el mismo hecho es ruido, no información.
    const service = setup();

    service.notify('comms');
    service.notify('comms');
    service.notify('comms');

    expect(toasts.length).toBe(1);
    expect(reloads).toBe(1);
  });

  it('módulos distintos avisan por separado', () => {
    const service = setup();

    service.notify('comms');
    service.notify('signatures');

    expect(toasts.length).toBe(2);
  });
});
