import { TestBed } from '@angular/core/testing';
import { NEVER, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { AccountHandoffStore } from './account-handoff.store';

describe('AccountHandoffStore', () => {
  function setup(requestAccountHandoff: () => unknown) {
    const request = vi.fn(requestAccountHandoff);
    TestBed.configureTestingModule({
      providers: [AccountHandoffStore, { provide: AuthService, useValue: { requestAccountHandoff: request } }],
    });
    return { store: TestBed.inject(AccountHandoffStore), request };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('mientras pide el vale queda "abriendo" y un segundo clic no pide otro', () => {
    const { store, request } = setup(() => NEVER);

    store.open('/account/plan');
    store.open('/account/plan');

    expect(store.opening()).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('si el vale no sale, apaga la carga y explica qué pasó', () => {
    const { store } = setup(() => throwError(() => new Error('down')));

    store.open();

    expect(store.opening()).toBe(false);
    expect(store.error()).toBe('Could not open your account. Please try again.');
  });

  it('al volver con "Atrás" desde el Landing (página restaurada de la caché) apaga la capa', () => {
    const { store } = setup(() => NEVER);
    store.open();

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));

    expect(store.opening()).toBe(false);
  });

  it('una carga normal de la página no toca una salida en curso', () => {
    const { store } = setup(() => NEVER);
    store.open();

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));

    expect(store.opening()).toBe(true);
  });
});
