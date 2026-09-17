import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  MySubscription,
  RenewCheckoutStatusResponse,
  StartRenewCheckoutRequest,
  StartRenewCheckoutResponse,
} from './subscription-status.model';

/**
 * Cliente HTTP del ciclo de vida de la suscripción de la firma (Expiración/Dunning, Fase 5).
 * Mismo patrón que el resto de servicios: HttpClient + ApiConfigService.tenantBase().
 */
@Injectable({ providedIn: 'root' })
export class SubscriptionStatusService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantBase();
  }

  getMySubscription(): Observable<MySubscription> {
    return this.http.get<MySubscription>(`${this.base}/subscriptions/me`);
  }

  /** Inicia el checkout de renovación self-service; devuelve la URL de redirect del provider. */
  startRenewCheckout(req: StartRenewCheckoutRequest): Observable<StartRenewCheckoutResponse> {
    return this.http.post<StartRenewCheckoutResponse>(`${this.base}/subscriptions/me/renew-checkout`, req);
  }

  /** Estado de una intención de renovación — se poll-ea al volver del redirect. */
  getRenewCheckoutStatus(intentId: string): Observable<RenewCheckoutStatusResponse> {
    return this.http.get<RenewCheckoutStatusResponse>(
      `${this.base}/subscriptions/me/renew-checkout/${intentId}`,
    );
  }
}
