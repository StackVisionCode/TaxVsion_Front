import { CUSTOM_ELEMENTS_SCHEMA, Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { filter, interval } from 'rxjs';
import { AccessStore } from '@core/access/access.store';
import { AuthService } from '@core/auth/auth.service';
import { AccountHandoffStore } from '@core/billing/account-handoff.store';
import { SubscriptionStatusStore } from '@core/billing/subscription-status.store';
import { platformBrand } from '@core/config/platform-config';
import { BrandLogoComponent } from '@core/theme/brand-logo.component';
import { PlatformBrandLogoComponent } from '@core/theme/platform-brand-logo.component';
import { MoneyPipe } from '@shared/pipes/money.pipe';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';

/** Quién mira la pantalla: el admin paga; el empleado (con o sin sesión) solo puede avisarle. */
type LockedViewer = 'admin' | 'member' | 'signed-out';

/** Cada cuánto se vuelve a mirar si el pago ya entró mientras la pantalla está a la vista. */
const RECHECK_MS = 20_000;

/**
 * Pantalla que tapa el CRM cuando la oficina no pagó la suscripción. Fuera del shell y del authGuard:
 * la abre el shell (estado de /me), el guard, o el login cuando rechaza a un empleado.
 *
 * El backend sigue siendo quien bloquea (login de empleados y portal); esto es la cara de ese bloqueo.
 * Al admin le da el camino a pagar y se quita sola cuando el pago entra.
 */
@Component({
  selector: 'app-subscription-locked',
  standalone: true,
  imports: [DatePipe, MoneyPipe, BrandLogoComponent, PlatformBrandLogoComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './subscription-locked.component.html',
  styleUrl: './subscription-locked.component.css',
})
export class SubscriptionLockedComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly access = inject(AccessStore);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly store = inject(SubscriptionStatusStore);
  protected readonly handoff = inject(AccountHandoffStore);
  protected readonly platform = platformBrand();

  protected readonly viewer = computed<LockedViewer>(() => {
    if (!this.auth.isLoggedIn()) return 'signed-out';
    return this.access.isAdmin() ? 'admin' : 'member';
  });

  protected readonly officeName = computed(() => this.auth.currentUser()?.tenant?.name ?? null);
  protected readonly summary = this.store.summary;

  /** Desde cuándo está cortado: suspensión, expiración o, si no hay marca, el fin del período. */
  protected readonly inactiveSince = computed(() => {
    const s = this.summary();
    return parseUtcDateOrNull(s?.suspendedAtUtc ?? s?.expiredAtUtc ?? s?.currentPeriodEndUtc);
  });

  protected readonly cycleLabel = computed(() => {
    const cycle = (this.summary()?.billingCycle ?? '').toLowerCase();
    if (cycle === 'monthly') return 'per month';
    if (cycle === 'annual' || cycle === 'yearly') return 'per year';
    return '';
  });

  protected readonly checking = signal(false);
  /** Se pidió "ya pagué" y el pago todavía no figura. */
  protected readonly stillPending = signal(false);

  constructor() {
    // En cuanto /me dice que ya no está bloqueada, de vuelta al trabajo.
    effect(() => {
      if (this.viewer() !== 'signed-out' && this.summary() && !this.store.isLocked()) {
        void this.router.navigateByUrl('/dashboard');
      }
    });
  }

  ngOnInit(): void {
    if (this.viewer() === 'signed-out') {
      return;
    }
    this.recheck();
    // Mientras la pestaña está a la vista se revisa solo: el admin puede pagar en otra pestaña.
    interval(RECHECK_MS)
      .pipe(
        filter(() => document.visibilityState === 'visible'),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.recheck());
    const onVisible = () => {
      if (document.visibilityState === 'visible') this.recheck();
    };
    document.addEventListener('visibilitychange', onVisible);
    this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', onVisible));
  }

  payNow(): void {
    this.handoff.open('/account/plan');
  }

  /** "Ya pagué" / "Try again": pide el estado y, si sigue bloqueada, lo dice en vez de no hacer nada. */
  checkAgain(): void {
    this.stillPending.set(false);
    this.checking.set(true);
    this.store.refresh().subscribe({
      next: () => {
        this.checking.set(false);
        this.stillPending.set(this.store.isLocked());
      },
      error: () => {
        this.checking.set(false);
        this.stillPending.set(true);
      },
    });
  }

  signOut(): void {
    this.auth.logout().subscribe({
      next: () => this.toLogin(),
      error: () => this.toLogin(),
    });
  }

  backToSignIn(): void {
    void this.router.navigateByUrl('/login');
  }

  private recheck(): void {
    this.store.refresh().subscribe({ error: () => {} });
  }

  private toLogin(): void {
    // Recarga dura, igual que la pantalla de asiento suspendido: no hereda estado del usuario que salió.
    window.location.assign('/login');
  }
}
