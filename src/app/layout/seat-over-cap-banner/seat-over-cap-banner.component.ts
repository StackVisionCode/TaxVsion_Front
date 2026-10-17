import { Component, computed, inject, signal } from '@angular/core';
import { PermissionService } from '@core/auth/permission.service';
import { AccountHandoffStore } from '@core/billing/account-handoff.store';
import { TenantLimits } from '@features/user-management/data-access/user-management.model';
import { UserManagementService } from '@features/user-management/data-access/user-management.service';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';

/**
 * Banner persistente del shell que avisa al TenantAdmin cuando el tenant está en over-cap de asientos
 * Standard: tiene más empleados activos (<c>activeUsers</c>) que asientos pagados (<c>maxUsers</c>).
 *
 * Pasa cuando un asiento comprado se suspende por falta de pago: el cupo baja (ver backend B2
 * EntitlementSnapshotBuilder que excluye Suspended) y, si el admin ya tenía el equipo lleno, los
 * N que sobran NO pierden acceso (política soft) pero el admin ve el banner persistente con CTA
 * "Pay now" hasta que resuelva — o pagando el seat suspended, o desactivando empleados.
 *
 * No duplica al SubscriptionBanner: si la suscripción entera está Suspended/Expired, ese banner ya
 * cubre todo; aquí solo medimos cupo por seats individuales mientras la suscripción está Active.
 *
 * Portal/Signature/ReadOnly/ServiceAccount NO se consideran — Portal/customers no se cuentan sin
 * decisión del senior (ver feedback_portal_customer_seats_no_contar_sin_senior).
 */
@Component({
  selector: 'app-seat-over-cap-banner',
  standalone: true,
  template: `
    @if (showBanner()) {
      <div
        class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 mb-4 text-sm text-amber-900"
        role="alert"
      >
        <span class="text-lg leading-none" aria-hidden="true">👥</span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">You're over your paid seat count</p>
          <p class="opacity-90">{{ message() }}</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
          [disabled]="handoff.opening()"
          (click)="handoff.open('/account/plan')"
        >
          {{ handoff.opening() ? 'Opening…' : 'Manage seats' }}
        </button>
      </div>
    }
  `,
})
export class SeatOverCapBannerComponent {
  private readonly users = inject(UserManagementService);
  private readonly router = inject(Router);
  protected readonly perms = inject(PermissionService);
  protected readonly handoff = inject(AccountHandoffStore);

  private readonly limits = signal<TenantLimits | null>(null);

  /** Solo TenantAdmin ve el banner (empleados no pueden hacer nada al respecto; el server los rechaza
   * del endpoint de billing igual). No lo mostramos si el tenant ya está Suspended por billing — ese
   * caso lo cubre el SubscriptionBanner que ofrece "Pay now" sobre la suscripción entera, no sobre seats. */
  readonly showBanner = computed(() => {
    const l = this.limits();
    if (!l) return false;
    if (!this.perms.isActor('TenantAdmin')) return false;
    if (l.isSuspendedForBilling) return false;
    if (l.maxUsers === null) return false;
    return l.activeUsers > l.maxUsers;
  });

  readonly message = computed(() => {
    const l = this.limits();
    if (!l || l.maxUsers === null) return '';
    const over = l.activeUsers - l.maxUsers;
    return `${l.activeUsers} active users on ${l.maxUsers} paid seats. Pay for ${over} more seat${over === 1 ? '' : 's'} or deactivate team members to clear the overage.`;
  });

  constructor() {
    this.loadLimits();
    // Al navegar entre pantallas se refresca por si el admin acaba de desactivar un usuario o pagar.
    // Trae un endpoint pequeño; no vale la pena un store global para esto solo.
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.loadLimits());
  }

  private loadLimits(): void {
    this.users.getTenantLimits().subscribe({
      next: l => this.limits.set(l),
      // Un fallo transitorio deja el banner oculto; no es información crítica como para pintar un error.
      error: () => {},
    });
  }
}
