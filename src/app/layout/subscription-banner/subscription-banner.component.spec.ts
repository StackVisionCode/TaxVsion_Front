import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PermissionService } from '@core/auth/permission.service';
import { AccountHandoffStore } from '@core/billing/account-handoff.store';
import { BillingPreference } from '@core/billing/billing-preference.service';
import { SubscriptionStatusStore } from '@core/billing/subscription-status.store';
import { SubscriptionBannerComponent } from './subscription-banner.component';

/**
 * El banner mezcla estado de suscripción con BillingPreference: tres variantes de pre-vencimiento (Auto
 * con PM, Auto sin PM, Manual) + lapso. Los stubs ocupan solo lo que lee el componente.
 */
describe('SubscriptionBannerComponent', () => {
  type Variant = 'auto-with-pm' | 'auto-no-pm' | 'manual' | null;

  function setup(opts: {
    status?: string;
    days?: number | null;
    nextRenewalAtUtc?: string | null;
    tone?: 'info' | 'warning' | 'critical';
    variant: Variant;
    isAdmin?: boolean;
  }) {
    const opened: string[] = [];
    const preference: BillingPreference | null = opts.variant === null
      ? null
      : opts.variant === 'manual'
        ? { mode: 'Manual', hasActiveMandate: false }
        : opts.variant === 'auto-with-pm'
          ? {
              mode: 'Automatic',
              hasActiveMandate: true,
              defaultPaymentMethod: { brand: 'Visa', last4: '4242', expMonth: 12, expYear: 2029 },
            }
          : { mode: 'Automatic', hasActiveMandate: true };
    const statusStub = {
      showBanner: signal(true),
      tone: signal(opts.tone ?? 'info'),
      status: signal(opts.status ?? 'active'),
      daysUntilRenewal: signal<number | null>(opts.days ?? 5),
      nextRenewalAtUtc: signal<string | null>(opts.nextRenewalAtUtc ?? '2026-11-10T00:00:00Z'),
      preference: signal<BillingPreference | null>(preference),
    };
    TestBed.configureTestingModule({
      imports: [SubscriptionBannerComponent],
      providers: [
        { provide: SubscriptionStatusStore, useValue: statusStub },
        { provide: PermissionService, useValue: { isAdmin: () => opts.isAdmin ?? true } },
        {
          provide: AccountHandoffStore,
          useValue: { opening: signal(false), error: signal<string | null>(null), open: (s: string) => opened.push(s) },
        },
      ],
    });
    const fixture = TestBed.createComponent(SubscriptionBannerComponent);
    fixture.detectChanges();
    return { fixture, page: fixture.nativeElement as HTMLElement, opened };
  }

  it('en Automatic con PM muestra la tarjeta y ofrece Manage billing', () => {
    const { page } = setup({ variant: 'auto-with-pm' });

    expect(page.textContent).toContain("We'll charge your Visa ending in 4242");
    expect(page.querySelector('button')?.textContent).toContain('Manage billing');
  });

  it('en Automatic sin PM avisa de la tarjeta ausente y ofrece Add card', () => {
    const { page } = setup({ variant: 'auto-no-pm' });

    expect(page.textContent).toContain("don't have a saved card");
    expect(page.querySelector('button')?.textContent).toContain('Add card');
  });

  it('en Manual mantiene el copy clásico y el botón Pay now', () => {
    const { page } = setup({ variant: 'manual' });

    expect(page.textContent).toContain("Pay now to renew, or wait");
    expect(page.querySelector('button')?.textContent).toContain('Pay now');
  });

  it('mientras la preferencia carga cae al copy neutro — no al Automatic equivocado', () => {
    const { page } = setup({ variant: null });

    expect(page.textContent).toContain('Pay now to settle the next');
    expect(page.querySelector('button')?.textContent).toContain('Pay now');
  });

  it('en lapso mantiene Pay now y el handoff al Account', () => {
    const { page, opened } = setup({ variant: 'auto-with-pm', status: 'expired', days: null, tone: 'critical' });

    expect(page.textContent).toContain('Your subscription has expired');
    page.querySelector('button')?.click();
    expect(opened).toEqual(['/account/plan']);
  });

  it('al staff sin permiso le dice a quién avisar en lapso', () => {
    const { page } = setup({ variant: 'manual', status: 'expired', days: null, tone: 'critical', isAdmin: false });

    expect(page.querySelector('button')).toBeNull();
    expect(page.textContent).toContain("Contact your firm's administrator.");
  });
});
