import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { PermissionService } from '@core/auth/permission.service';
import { AccountHandoffStore } from '@core/billing/account-handoff.store';
import { SubscriptionStatusStore } from '@core/billing/subscription-status.store';

/**
 * Banner global del ciclo de vida de la suscripción de la firma. Tres modos de pre-vencimiento según
 * la BillingPreference del tenant:
 *  - Automatic + PM default → "we'll charge your card on {date}", botón "Manage billing".
 *  - Automatic + sin PM     → aviso de card ausente, botón "Add card".
 *  - Manual (o cargando)    → copy clásico "Pay now to renew".
 * Lapso (PastDue/Suspended/Expired/BillingAccessBlocked) sigue mostrando "Pay now" sin importar el modo.
 */
@Component({
  selector: 'app-subscription-banner',
  standalone: true,
  template: `
    @if (store.showBanner()) {
      <div
        class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-4 py-3 mb-4 text-sm"
        [class.border-sky-300]="store.tone() === 'info'"
        [class.bg-sky-50]="store.tone() === 'info'"
        [class.text-sky-900]="store.tone() === 'info'"
        [class.border-amber-300]="store.tone() === 'warning'"
        [class.bg-amber-50]="store.tone() === 'warning'"
        [class.text-amber-900]="store.tone() === 'warning'"
        [class.border-red-300]="store.tone() === 'critical'"
        [class.bg-red-50]="store.tone() === 'critical'"
        [class.text-red-900]="store.tone() === 'critical'"
        role="alert"
      >
        <span class="text-lg leading-none" aria-hidden="true">{{ icon() }}</span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">{{ title() }}</p>
          <p class="opacity-90">{{ message() }}</p>
        </div>
        @if (perms.isAdmin() && showPayButton()) {
          <button
            type="button"
            class="shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-60"
            [class.bg-sky-600]="store.tone() === 'info'"
            [class.hover:bg-sky-700]="store.tone() === 'info'"
            [class.bg-amber-600]="store.tone() === 'warning'"
            [class.hover:bg-amber-700]="store.tone() === 'warning'"
            [class.bg-red-600]="store.tone() === 'critical'"
            [class.hover:bg-red-700]="store.tone() === 'critical'"
            [disabled]="handoff.opening()"
            (click)="handoff.open('/account/plan')"
          >
            {{ handoff.opening() ? 'Opening…' : buttonLabel() }}
          </button>
        } @else if (!perms.isAdmin() && isLapsed()) {
          <span class="shrink-0 opacity-80">Contact your firm's administrator.</span>
        }
      </div>
    }
  `,
})
export class SubscriptionBannerComponent {
  protected readonly store = inject(SubscriptionStatusStore);
  protected readonly handoff = inject(AccountHandoffStore);
  protected readonly perms = inject(PermissionService);
  private readonly datePipe = new DatePipe('en-US');

  /** El acceso está cortado o el pago ya falló: hay algo que pagar y el backend acepta el checkout. */
  protected readonly isLapsed = computed(() => {
    const s = (this.store.status() ?? '').toLowerCase();
    return s === 'pastdue' || s === 'suspended' || s === 'expired';
  });

  /** Pre-vencimiento con sub todavía activa: la copy depende de la BillingPreference. */
  protected readonly isPreRenewal = computed(() => !this.isLapsed() && this.store.daysUntilRenewal() !== null);

  /** Variante por preferencia; 'loading' mientras no hay respuesta — evita el flash del copy equivocado. */
  protected readonly preferenceVariant = computed<'auto-with-pm' | 'auto-no-pm' | 'manual' | 'loading'>(() => {
    const pref = this.store.preference();
    if (!pref) return 'loading';
    if (pref.mode === 'Manual') return 'manual';
    return pref.defaultPaymentMethod ? 'auto-with-pm' : 'auto-no-pm';
  });

  /** El botón sale siempre que hay algo que hacer: lapso, Manual (pagar), o Automatic (manage/add card). */
  protected readonly showPayButton = computed(() => this.isLapsed() || this.isPreRenewal());

  protected readonly buttonLabel = computed(() => {
    if (this.isLapsed()) return 'Pay now';
    switch (this.preferenceVariant()) {
      case 'auto-with-pm':
        return 'Manage billing';
      case 'auto-no-pm':
        return 'Add card';
      default:
        return 'Pay now';
    }
  });

  protected readonly icon = computed(() => {
    const tone = this.store.tone();
    if (tone === 'critical') return '⛔';
    if (tone === 'warning') return '⚠️';
    if (tone === 'info') return '📅';
    return 'ℹ️';
  });

  protected readonly title = computed(() => {
    if (this.isPreRenewal()) {
      const d = this.store.daysUntilRenewal()!;
      if (d <= 1) return d === 0 ? 'Your billing period ends today' : 'Your billing period ends tomorrow';
      return `Your billing period ends in ${d} day${d === 1 ? '' : 's'}`;
    }
    switch ((this.store.status() ?? '').toLowerCase()) {
      case 'pastdue':
        return 'Your last subscription payment failed';
      case 'suspended':
        return 'Your subscription is suspended';
      case 'expired':
        return 'Your subscription has expired';
      default:
        return 'Subscription attention needed';
    }
  });

  protected readonly message = computed(() => {
    if (this.isPreRenewal()) {
      const next = this.store.nextRenewalAtUtc();
      const when = next ? this.datePipe.transform(next, 'longDate') : null;
      const pref = this.store.preference();
      const pm = pref?.defaultPaymentMethod;
      switch (this.preferenceVariant()) {
        case 'auto-with-pm':
          return when && pm
            ? `We'll charge your ${pm.brand} ending in ${pm.last4} on ${when}.`
            : "Your subscription will renew automatically. We'll email you a receipt.";
        case 'auto-no-pm':
          return when
            ? `Your subscription will try to charge automatically on ${when} but we don't have a saved card.`
            : "Your subscription is set to renew automatically but we don't have a saved card yet.";
        case 'manual':
          return when
            ? `Your subscription period ends on ${when}. Pay now to renew, or wait — we'll remind you again.`
            : "Pay now to renew, or wait — we'll remind you again at the end.";
        case 'loading':
        default:
          return when
            ? `Pay now to settle the next ${when} charge early. Nothing happens if you wait — we'll remind you again.`
            : "Pay now to settle the next charge early. Nothing happens if you wait — we'll remind you again.";
      }
    }
    switch ((this.store.status() ?? '').toLowerCase()) {
      case 'pastdue':
        return 'Pay now to avoid any interruption to your team.';
      case 'suspended':
        return "Your team's access is paused. Pay now to restore it right away.";
      case 'expired':
        return 'Pay now to restore access — your data is safe and waiting.';
      default:
        return 'Please review your subscription to keep your access.';
    }
  });
}
