import { Injectable, computed, inject, signal } from '@angular/core';
import { take, takeWhile, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { AuthService } from '@core/auth/auth.service';
import { toApiError } from '@core/models/api-error.model';
import { SubscriptionStatusService } from './subscription-status.service';
import { MySubscription, SubscriptionTone, toneForStatus } from './subscription-status.model';

/** Clave del intentId de renovación en sessionStorage, para retomar el poll al volver del redirect. */
export const RENEW_CHECKOUT_INTENT_KEY = 'renewCheckoutIntentId';

/**
 * Estado global (root singleton) de la suscripción de la firma para el banner de ciclo de vida
 * (Expiración/Dunning, Fase 5). Carga `GET /subscriptions/me`, expone el estado/tono para el banner, y
 * conduce la renovación self-service (redirect a hosted-checkout + poll al volver). Sobrevive el cambio de
 * ruta — el banner vive en el shell autenticado. Molde: seat-purchase.store + poll-on-return de seats.
 */
@Injectable({ providedIn: 'root' })
export class SubscriptionStatusStore {
  private readonly service = inject(SubscriptionStatusService);
  private readonly auth = inject(AuthService);

  private readonly _summary = signal<MySubscription | null>(null);
  private readonly _blocked = signal(false);
  private readonly _renewing = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly summary = this._summary.asReadonly();
  readonly renewing = this._renewing.asReadonly();
  readonly error = this._error.asReadonly();

  /** Estado efectivo: el de `/me`, o "Suspended" si un 403 nos marcó bloqueado antes de poder cargar. */
  readonly status = computed<string | null>(() => this._summary()?.status ?? (this._blocked() ? 'Suspended' : null));
  readonly tone = computed<SubscriptionTone>(() => toneForStatus(this.status()));
  /** El banner aparece en cualquier estado de lapso (o si un 403 nos marcó bloqueado). */
  readonly showBanner = computed(() => this.tone() !== 'ok');
  readonly gracePeriodEndsAtUtc = computed(() => this._summary()?.gracePeriodEndsAtUtc ?? null);

  /** Carga el estado real de la suscripción (idempotente, silenciosa: no rompe la app si falla). */
  load(): void {
    this.service.getMySubscription().subscribe({
      next: summary => {
        this._summary.set(summary);
        this._blocked.set(summary.billingAccessBlocked);
      },
      error: () => {
        // Silencioso: si /me falla (p.ej. 403 por bloqueo), el interceptor ya marcó `_blocked`.
      },
    });
  }

  /** Lo llama el interceptor al recibir `Auth.SubscriptionInactive`: fuerza el banner aunque no haya /me. */
  markBlockedFromError(): void {
    this._blocked.set(true);
  }

  /**
   * Inicia la renovación self-service y redirige al hosted-checkout del provider. Guarda el intentId en
   * sessionStorage para retomar el poll al volver (successUrl/cancelUrl = URL actual, sin query).
   */
  startRenewAndRedirect(provider = 'Stripe'): void {
    if (this._renewing()) return;
    this._renewing.set(true);
    this._error.set(null);
    const returnUrl = window.location.href.split('?')[0];
    this.service
      .startRenewCheckout({
        payerEmail: this.auth.currentUser()?.email ?? '',
        successUrl: returnUrl,
        cancelUrl: returnUrl,
        provider,
        method: provider === 'PayPal' ? 'Wallet' : 'Card',
      })
      .subscribe({
        next: res => {
          try {
            sessionStorage.setItem(RENEW_CHECKOUT_INTENT_KEY, res.renewalIntentId);
          } catch {
            /* sessionStorage no disponible: seguimos igual, el reconcile del backend es el respaldo */
          }
          window.location.href = res.checkoutUrl;
        },
        error: err => {
          this._renewing.set(false);
          this._error.set(toApiError(err).message);
        },
      });
  }

  /**
   * Al volver del redirect: si hay un intentId pendiente, poll-ea su estado (acotado) hasta
   * Provisioned/Failed y recarga la suscripción cuando se reactiva. Molde: resumePendingSeatCheckout.
   */
  resumePendingRenewCheckout(): void {
    let intentId: string | null = null;
    try {
      intentId = sessionStorage.getItem(RENEW_CHECKOUT_INTENT_KEY);
      if (intentId) sessionStorage.removeItem(RENEW_CHECKOUT_INTENT_KEY);
    } catch {
      intentId = null;
    }
    if (!intentId) return;

    timer(0, 2500)
      .pipe(
        switchMap(() => this.service.getRenewCheckoutStatus(intentId)),
        takeWhile(status => status.status === 'Pending' || status.status === 'Paid', true),
        take(20),
      )
      .subscribe({
        next: status => {
          if (status.status === 'Provisioned') {
            this._blocked.set(false);
            this.load();
          }
        },
        error: () => {
          /* el reconcile-twin del backend reactiva igual; no molestamos al usuario */
        },
      });
  }
}
