import { Injectable, computed, inject, signal } from '@angular/core';
import {
  EMPTY,
  catchError,
  concatMap,
  first,
  firstValueFrom,
  forkJoin,
  map,
  of,
  retry,
  switchMap,
  tap,
  timeout,
  timer,
} from 'rxjs';
import { CheckoutIntentService } from '@core/billing/checkout-intent.service';
import { toApiError } from '@core/models/api-error.model';
import { CheckoutService } from './checkout.service';
import { CheckoutPhase, SubscriptionSummary } from './checkout.model';

/**
 * Estado + orquestación del checkout: adjuntar tarjeta → cambiar de plan (gatea en pago) →
 * sondear la suscripción hasta que el cobro Stripe aplica el upgrade. Al terminar limpia el intent.
 */
@Injectable()
export class CheckoutStore {
  private readonly service = inject(CheckoutService);
  private readonly checkoutIntent = inject(CheckoutIntentService);

  readonly subscription = signal<SubscriptionSummary | null>(null);
  readonly loading = signal(false);
  readonly phase = signal<CheckoutPhase>('idle');
  readonly error = signal<string | null>(null);

  readonly intent = computed(() => this.checkoutIntent.intent());
  readonly onTargetPlan = computed(() => {
    const i = this.intent();
    const s = this.subscription();
    return !!i && !!s && s.planCode.toLowerCase() === i.planCode.toLowerCase();
  });

  loadSubscription(): void {
    this.loading.set(true);
    this.service.getSubscription().subscribe({
      next: s => {
        this.subscription.set(s);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(toApiError(err).message);
        this.loading.set(false);
      },
    });
  }

  /**
   * Crea el SetupIntent y devuelve su client_secret para el Payment Element. Reintenta con backoff
   * ante el 403 por la race de la proyección RBAC (el permiso del admin recién creado se proyecta
   * async tras UserRolesChanged).
   */
  loadSetupIntentAsync(): Promise<string> {
    return firstValueFrom(
      this.service.createSetupIntent().pipe(
        retry({ count: 6, delay: () => timer(1500) }),
        map(r => r.clientSecret)
      )
    );
  }

  pay(paymentMethodReference: string): void {
    const intent = this.intent();
    if (!intent) return;
    this.phase.set('paying');
    this.error.set(null);

    const target = intent.planCode.toLowerCase();
    this.service
      .attachCard(paymentMethodReference)
      .pipe(
        concatMap(() => this.service.changePlan(intent.planCode, intent.billingCycle)),
        tap(() => this.phase.set('confirming')),
        // El cobro y el upgrade se aplican async: sondeamos hasta ver el plan destino (éxito) o un
        // cambio de plan en estado PaymentFailed (cobro rechazado).
        concatMap(() =>
          timer(0, 1500).pipe(
            switchMap(() =>
              forkJoin({
                sub: this.service.getSubscription(),
                pending: this.service.getPendingPlanChange().pipe(catchError(() => of(null))),
              })
            ),
            tap(({ sub }) => this.subscription.set(sub)),
            first(
              ({ sub, pending }) =>
                sub.planCode.toLowerCase() === target || pending?.status === 'PaymentFailed'
            ),
            timeout(25000)
          )
        ),
        catchError(err => {
          // attach o change-plan fallaron (p.ej. tarjeta rechazada al adjuntar), o timeout confirmando.
          this.error.set(
            this.phase() === 'confirming'
              ? 'No pudimos confirmar el pago a tiempo. Revisa tu suscripción en unos minutos.'
              : toApiError(err).message
          );
          this.phase.set('error');
          return EMPTY;
        })
      )
      .subscribe(({ pending }) => {
        if (pending?.status === 'PaymentFailed') {
          this.error.set('Tu pago fue rechazado. Prueba con otra tarjeta.');
          this.phase.set('error');
        } else {
          this.phase.set('done');
          this.checkoutIntent.clear();
        }
      });
  }

  /** El usuario decide pagar más tarde: limpia el intent y sigue en la trial. */
  skip(): void {
    this.checkoutIntent.clear();
  }
}
