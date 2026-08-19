import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { SubscriptionSummary } from './checkout.model';

/**
 * Llamadas del checkout (autenticado, con la sesión del tenant). Route-scoped.
 * Camino real verificado: adjuntar método de pago (payment-app) → cambiar de plan (subscription,
 * gatea en pago) → el cobro Stripe aplica el upgrade.
 */
@Injectable()
export class CheckoutService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantBase();
  }

  getSubscription(): Observable<SubscriptionSummary> {
    return this.http.get<SubscriptionSummary>(`${this.base}/subscriptions/me`);
  }

  /** Crea un SetupIntent en Stripe y devuelve el client_secret para el Payment Element. */
  createSetupIntent(): Observable<{ clientSecret: string }> {
    return this.http.post<{ clientSecret: string }>(
      `${this.base}/payments-app/provider-customers/Stripe/setup-intent`,
      {}
    );
  }

  /** Adjunta el método de pago (referencia de PaymentMethod de Stripe) y lo deja por defecto. */
  attachCard(paymentMethodReference: string): Observable<unknown> {
    return this.http.post(`${this.base}/payments-app/provider-customers/Stripe/methods`, {
      paymentMethodReference,
      setAsDefault: true,
    });
  }

  /** Cambia de plan. Responde 202 PaymentProcessing; el cobro se resuelve async. */
  changePlan(planCode: string, billingCycle: 'Monthly' | 'Yearly'): Observable<unknown> {
    return this.http.post(`${this.base}/subscriptions/change-plan`, { planCode, billingCycle });
  }

  /** Cambio de plan pendiente/fallido. status: AwaitingPayment | PaymentFailed | … (null si no hay). */
  getPendingPlanChange(): Observable<PendingPlanChange | null> {
    return this.http.get<PendingPlanChange | null>(`${this.base}/subscriptions/plan-change`);
  }
}

export interface PendingPlanChange {
  kind: string;
  toPlanCode: string;
  status: string;
}
