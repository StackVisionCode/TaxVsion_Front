import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { PermissionService } from '@core/auth/permission.service';
import { SubscriptionStatusStore } from '@core/billing/subscription-status.store';

/**
 * Banner global del ciclo de vida de la suscripción de la firma (Expiración/Dunning, Fase 5). Aparece en el
 * shell autenticado cuando la suscripción está en lapso (PastDue/GracePeriod/Suspended/Expired) y ofrece
 * renovar. El botón "Renew" solo se muestra a admins/owner (el staff sin permiso queda cortado por el backend
 * antes de llegar acá). El copy y el color escalan con el estado.
 */
@Component({
  selector: 'app-subscription-banner',
  standalone: true,
  template: `
    @if (store.showBanner()) {
      <div
        class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-4 py-3 mb-4 text-sm"
        [class.border-amber-300]="store.tone() === 'warning'"
        [class.bg-amber-50]="store.tone() === 'warning'"
        [class.text-amber-900]="store.tone() === 'warning'"
        [class.border-red-300]="store.tone() === 'critical'"
        [class.bg-red-50]="store.tone() === 'critical'"
        [class.text-red-900]="store.tone() === 'critical'"
        role="alert"
      >
        <span class="text-lg leading-none" aria-hidden="true">{{ store.tone() === 'critical' ? '⛔' : '⚠️' }}</span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">{{ title() }}</p>
          <p class="opacity-90">{{ message() }}</p>
        </div>
        @if (perms.isAdmin()) {
          <button
            type="button"
            class="shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-60"
            [class.bg-amber-600]="store.tone() === 'warning'"
            [class.hover:bg-amber-700]="store.tone() === 'warning'"
            [class.bg-red-600]="store.tone() === 'critical'"
            [class.hover:bg-red-700]="store.tone() === 'critical'"
            [disabled]="store.renewing()"
            (click)="store.startRenewAndRedirect()"
          >
            {{ store.renewing() ? 'Starting…' : 'Renew now' }}
          </button>
        } @else {
          <span class="shrink-0 opacity-80">Contact your firm's administrator.</span>
        }
      </div>
    }
  `,
})
export class SubscriptionBannerComponent {
  protected readonly store = inject(SubscriptionStatusStore);
  protected readonly perms = inject(PermissionService);
  private readonly datePipe = new DatePipe('en-US');

  protected readonly title = computed(() => {
    switch ((this.store.status() ?? '').toLowerCase()) {
      case 'pastdue':
        return 'Your last subscription payment failed';
      case 'graceperiod':
        return 'Action needed to keep your access';
      case 'suspended':
        return 'Your subscription is suspended';
      case 'expired':
        return 'Your subscription has expired';
      default:
        return 'Subscription attention needed';
    }
  });

  protected readonly message = computed(() => {
    const status = (this.store.status() ?? '').toLowerCase();
    if (status === 'graceperiod') {
      const end = this.store.gracePeriodEndsAtUtc();
      const when = end ? this.datePipe.transform(end, 'longDate') : null;
      return when
        ? `We couldn't renew your subscription. Access will be paused on ${when} unless payment is updated.`
        : "We couldn't renew your subscription. Renew now to avoid an interruption.";
    }
    switch (status) {
      case 'pastdue':
        return 'Update your payment method to avoid any interruption to your team.';
      case 'suspended':
        return "Your team's access is paused. Renew to restore it right away.";
      case 'expired':
        return 'Renew to restore access — your data is safe and waiting.';
      default:
        return 'Please review your subscription to keep your access.';
    }
  });
}
