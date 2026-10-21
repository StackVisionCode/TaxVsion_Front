import { afterEach, describe, expect, it, vi } from 'vitest';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AccessStore } from '@core/access/access.store';
import { AuthService } from '@core/auth/auth.service';
import { AccountHandoffStore } from '@core/billing/account-handoff.store';
import { MySubscription } from '@core/billing/subscription-status.model';
import { SubscriptionStatusStore } from '@core/billing/subscription-status.store';
import { MoneyPipe } from '@shared/pipes/money.pipe';
import { SubscriptionLockedComponent } from './subscription-locked.component';

/**
 * La pantalla de oficina sin pagar: el admin ve cuánto debe y paga; el empleado solo puede avisar; y se
 * quita sola cuando el pago entra.
 */
describe('SubscriptionLockedComponent', () => {
  const suspended = {
    planName: 'Professional',
    status: 'Suspended',
    billingCycle: 'Monthly',
    currentCyclePriceUsd: 89,
    currentPeriodEndUtc: '2026-10-18T00:00:00',
    suspendedAtUtc: '2026-10-18T00:00:00',
    billingAccessBlocked: true,
  } as MySubscription;

  function setup(viewer: 'admin' | 'member' | 'signed-out', afterRefresh: MySubscription = suspended) {
    const summary = signal<MySubscription | null>(viewer === 'signed-out' ? null : suspended);
    const locked = signal(true);
    const store = {
      summary,
      isLocked: locked,
      refresh: vi.fn(() => {
        summary.set(afterRefresh);
        locked.set(afterRefresh.billingAccessBlocked);
        return of(afterRefresh);
      }),
    };
    const opened: string[] = [];
    TestBed.configureTestingModule({
      imports: [SubscriptionLockedComponent],
      providers: [
        provideRouter([]),
        { provide: SubscriptionStatusStore, useValue: store },
        { provide: AccessStore, useValue: { isAdmin: signal(viewer === 'admin') } },
        {
          provide: AuthService,
          useValue: {
            isLoggedIn: signal(viewer !== 'signed-out'),
            currentUser: signal({ tenant: { id: 't1', name: 'Acme Tax', subDomain: 'acme' } }),
            logout: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: AccountHandoffStore,
          useValue: { opening: signal(false), error: signal<string | null>(null), open: (s: string) => opened.push(s) },
        },
      ],
    });
    // Los logos piden la marca por HTTP: fuera del test, la pantalla se prueba sin ellos.
    TestBed.overrideComponent(SubscriptionLockedComponent, {
      set: { imports: [DatePipe, MoneyPipe], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(SubscriptionLockedComponent);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    const click = (testId: string) => {
      (page.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click();
      fixture.detectChanges();
    };
    return { fixture, page, store, opened, navigate, click };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('al admin le muestra el plan y el monto, y Pay now lo lleva al Manage Subscription', () => {
    const { page, opened, click } = setup('admin');

    expect(page.textContent).toContain('Your subscription is inactive');
    expect(page.querySelector('[data-testid="locked-facts"]')?.textContent).toContain('Professional');
    expect(page.querySelector('[data-testid="locked-facts"]')?.textContent).toContain('$89.00');

    click('pay-now');

    expect(opened).toEqual(['/account/plan']);
  });

  it('si el admin dice que ya pagó y el pago no figura, lo avisa en vez de no hacer nada', () => {
    const { page, click } = setup('admin');

    click('check-again');

    expect(page.querySelector('[data-testid="still-pending"]')).not.toBeNull();
  });

  it('cuando el pago entra, vuelve sola al dashboard', () => {
    const { navigate } = setup('admin', { ...suspended, status: 'Active', billingAccessBlocked: false });

    TestBed.tick();

    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('al empleado no le ofrece pagar: solo reintentar y salir', () => {
    const { page, store, click } = setup('member');

    expect(page.textContent).toContain("Your office's access is paused");
    expect(page.querySelector('[data-testid="pay-now"]')).toBeNull();
    store.refresh.mockClear();

    click('check-again');

    expect(store.refresh).toHaveBeenCalledTimes(1);
    expect(page.querySelector('[data-testid="sign-out"]')).not.toBeNull();
  });

  it('al empleado rechazado en el login no le pide nada al backend y lo deja volver al sign in', () => {
    const { page, store, navigate, click } = setup('signed-out');

    expect(store.refresh).not.toHaveBeenCalled();
    expect(page.querySelector('[data-testid="pay-now"]')).toBeNull();
    expect(page.querySelector('[data-testid="sign-out"]')).toBeNull();

    click('back-to-sign-in');

    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
