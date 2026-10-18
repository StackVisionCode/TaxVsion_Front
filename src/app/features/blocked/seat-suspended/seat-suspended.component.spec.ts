import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { SeatSlotGatedStore } from '@core/auth/seat-slot-gated.store';
import { SeatSuspendedComponent } from './seat-suspended.component';

/**
 * SG-8 — la pantalla a la que llega el empleado gated.
 *
 * - Pinta `slotIndex` y `effectiveCap` cuando están disponibles (G-C3 lo requiere para que el admin
 *   que recibe el "Contact admin" entienda el pedido).
 * - "Sign out" dispara el logout y manda al login (sin dejar al usuario trabado en la pantalla).
 * - "Contact admin" arma un mailto con subject prellenado que nombra la oficina.
 */
describe('SeatSuspendedComponent', () => {
  const authState = {
    tenant: { id: 't1', name: 'Acme Tax', subDomain: 'acme' },
  };
  const auth = {
    currentUser: () => authState,
    logout: vi.fn(() => of(void 0)),
  };
  const payload = signal<{ slotIndex: number; effectiveCap: number; contactAdminUrl: string } | null>({
    slotIndex: 11,
    effectiveCap: 10,
    contactAdminUrl: 'https://acme.taxoffix.io/account/users',
  });
  const store = {
    state: payload,
    isGated: () => payload() !== null,
    setGatedState: vi.fn(),
    clear: vi.fn(() => payload.set(null)),
  };
  const assign = vi.fn();

  beforeEach(() => {
    auth.logout.mockClear();
    store.setGatedState.mockClear();
    store.clear.mockClear();
    assign.mockClear();
    payload.set({ slotIndex: 11, effectiveCap: 10, contactAdminUrl: 'https://acme.taxoffix.io/account/users' });
    vi.stubGlobal('location', { assign });
    TestBed.configureTestingModule({
      imports: [SeatSuspendedComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: SeatSlotGatedStore, useValue: store },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('renderiza el slot y el cap cuando el store los tiene', () => {
    const fixture = TestBed.createComponent(SeatSuspendedComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Your seat is suspended');
    expect(text).toContain('Slot 11 of 10');
  });

  it('sin payload no revienta: solo oculta el renglón de slot', () => {
    payload.set(null);
    const fixture = TestBed.createComponent(SeatSuspendedComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Your seat is suspended');
    expect(text).not.toContain('Slot');
  });

  it('"Contact admin" arma un mailto con el subject prellenado con el nombre de la oficina', () => {
    const fixture = TestBed.createComponent(SeatSuspendedComponent);
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('[data-testid="contact-admin"]') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    // mailto:?subject=Please%20free%20my%20seat%20on%20Acme%20Tax
    expect(link.href.startsWith('mailto:')).toBe(true);
    expect(decodeURIComponent(link.href)).toContain('Please free my seat on Acme Tax');
  });

  it('"Sign out" llama al logout del AuthService y redirige a /login', () => {
    const fixture = TestBed.createComponent(SeatSuspendedComponent);
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('[data-testid="sign-out"]') as HTMLButtonElement;
    btn.click();

    expect(auth.logout).toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('/login');
  });
});
