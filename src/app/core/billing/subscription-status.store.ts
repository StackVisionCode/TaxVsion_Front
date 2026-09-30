import { Injectable, computed, inject, signal } from '@angular/core';
import { take, takeWhile, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { AuthService } from '@core/auth/auth.service';
import { toApiError } from '@core/models/api-error.model';
import { SubscriptionStatusService } from './subscription-status.service';
import { MySubscription, SubscriptionTone, toneForStatus } from './subscription-status.model';

/** Clave del intentId de renovación en sessionStorage, para retomar el poll al volver del redirect. */
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
  private readonly _error = signal<string | null>(null);

  readonly summary = this._summary.asReadonly();
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
}
