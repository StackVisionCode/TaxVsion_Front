import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PermissionService } from '@core/auth/permission.service';
import { AccountHandoffStore } from '@core/billing/account-handoff.store';
import { SubscriptionStatusStore } from '@core/billing/subscription-status.store';
import { SubscriptionBannerComponent } from './subscription-banner.component';

/**
 * Renovar es un cobro, así que se hace en el Account. El banner sigue avisando en el espacio de trabajo,
 * pero el botón sale allí con la misma sesión en vez de abrir el checkout acá.
 */
describe('SubscriptionBannerComponent', () => {
  function setup(isAdmin = true) {
    const opened: string[] = [];
    const statusStub = {
      showBanner: signal(true),
      tone: signal('critical'),
      status: signal('expired'),
      gracePeriodEndsAtUtc: signal<string | null>(null),
    };
    TestBed.configureTestingModule({
      imports: [SubscriptionBannerComponent],
      providers: [
        { provide: SubscriptionStatusStore, useValue: statusStub },
        { provide: PermissionService, useValue: { isAdmin: () => isAdmin } },
        {
          provide: AccountHandoffStore,
          useValue: { opening: signal(false), error: signal<string | null>(null), open: (s: string) => opened.push(s) },
        },
      ],
    });
    const fixture = TestBed.createComponent(SubscriptionBannerComponent);
    fixture.detectChanges();
    return { fixture, page: fixture.nativeElement as HTMLElement, opened, statusStub };
  }

  it('avisa que la suscripción venció y ofrece renovar', () => {
    const { page } = setup();

    expect(page.textContent).toContain('Your subscription has expired');
    expect(page.textContent).toContain('Renew now');
  });

  it('renovar sale al Account, no abre el cobro en el espacio de trabajo', () => {
    const { page, opened } = setup();

    page.querySelector('button')?.click();

    expect(opened).toEqual(['/account/plan']);
  });

  // Quien no administra no ve el botón: el backend lo corta igual, pero no se ofrece lo que no se puede.
  it('al staff sin permiso le dice a quién avisar', () => {
    const { page } = setup(false);

    expect(page.querySelector('button')).toBeNull();
    expect(page.textContent).toContain("Contact your firm's administrator.");
  });
});
