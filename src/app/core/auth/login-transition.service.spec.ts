import { TestBed } from '@angular/core/testing';
import { NavigationCancel, NavigationCancellationCode, NavigationEnd, NavigationError, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginTransitionService } from './login-transition.service';

/**
 * Reglas de cierre de la escena login → dashboard. El Router se reemplaza por un Subject de
 * eventos: el servicio solo escucha `router.events`.
 */
describe('LoginTransitionService', () => {
  let events: Subject<unknown>;
  let service: LoginTransitionService;

  const end = (url: string) => events.next(new NavigationEnd(1, url, url));
  /** Dos frames de rAF (los timers falsos de Vitest también cubren requestAnimationFrame). */
  const paint = () => vi.advanceTimersByTime(40);

  beforeEach(() => {
    vi.useFakeTimers();
    // Reloj y frames deterministas sobre los timers falsos, pase lo que pase con los defaults de Vitest.
    vi.stubGlobal('performance', { now: () => Date.now() });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    events = new Subject();
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: { events: events.asObservable() } }],
    });
    service = TestBed.inject(LoginTransitionService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('start() activa la escena con el caption por defecto, y acepta uno propio', () => {
    service.start();
    expect(service.active()).toBe(true);
    expect(service.leaving()).toBe(false);
    expect(service.caption()).toBe(LoginTransitionService.DEFAULT_CAPTION);

    service.start({ caption: 'Signing you in...' });
    expect(service.caption()).toBe('Signing you in...');
  });

  it('al llegar al dashboard espera el pintado y el mínimo visible, se desvanece y se desmonta', () => {
    service.start();
    end('/dashboard');
    paint();
    // Resolvió rápido: sigue visible hasta cumplir MIN_VISIBLE_MS.
    expect(service.active()).toBe(true);
    expect(service.leaving()).toBe(false);

    vi.advanceTimersByTime(LoginTransitionService.MIN_VISIBLE_MS);
    expect(service.leaving()).toBe(true);
    expect(service.active()).toBe(true);

    vi.advanceTimersByTime(LoginTransitionService.EXIT_MS);
    expect(service.active()).toBe(false);
    expect(service.leaving()).toBe(false);
  });

  it('si el trabajo ya superó el mínimo visible, sale apenas pinta el destino', () => {
    service.start();
    vi.advanceTimersByTime(1500);
    end('/dashboard');
    paint();
    expect(service.leaving()).toBe(true);
  });

  it('de vuelta en una página de auth (términos, alta de MFA) se esconde en el acto', () => {
    service.start();
    end('/terms');
    expect(service.active()).toBe(false);
    expect(service.leaving()).toBe(false);

    service.start();
    end('/login/setup-mfa?x=1');
    expect(service.active()).toBe(false);
  });

  it('un NavigationCancel por redirect de guard no la esconde: espera la navegación nueva', () => {
    service.start();
    events.next(new NavigationCancel(1, '/dashboard', 'redirect', NavigationCancellationCode.Redirect));
    expect(service.active()).toBe(true);

    end('/dashboard');
    paint();
    vi.advanceTimersByTime(LoginTransitionService.MIN_VISIBLE_MS);
    expect(service.leaving()).toBe(true);
  });

  it('un redirect de guard que termina en auth la esconde al aterrizar', () => {
    service.start();
    events.next(new NavigationCancel(1, '/dashboard', 'redirect', NavigationCancellationCode.Redirect));
    end('/terms');
    expect(service.active()).toBe(false);
  });

  it('guard rechazado o error de navegación la esconden', () => {
    service.start();
    events.next(new NavigationCancel(1, '/dashboard', 'rejected', NavigationCancellationCode.GuardRejected));
    expect(service.active()).toBe(false);

    service.start();
    events.next(new NavigationError(1, '/dashboard', new Error('boom')));
    expect(service.active()).toBe(false);
  });

  it('tras cancel() ignora lo que venga del router y de los timers', () => {
    service.start();
    service.cancel();
    end('/dashboard');
    paint();
    vi.advanceTimersByTime(LoginTransitionService.MAX_VISIBLE_MS);
    expect(service.active()).toBe(false);
    expect(service.leaving()).toBe(false);
  });

  it('sin navegación se retira sola al tope de seguridad', () => {
    service.start();
    vi.advanceTimersByTime(LoginTransitionService.MAX_VISIBLE_MS);
    paint();
    expect(service.leaving()).toBe(true);
    vi.advanceTimersByTime(LoginTransitionService.EXIT_MS);
    expect(service.active()).toBe(false);
  });

  it('con prefers-reduced-motion sale sin fase de desvanecimiento', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    service.start();
    end('/dashboard');
    paint();
    expect(service.active()).toBe(true);
    vi.advanceTimersByTime(LoginTransitionService.REDUCED_MIN_VISIBLE_MS);
    expect(service.active()).toBe(false);
    expect(service.leaving()).toBe(false);
  });

  it('sin document (SSR) start() no hace nada', () => {
    vi.stubGlobal('document', undefined);
    service.start();
    expect(service.active()).toBe(false);
  });
});
