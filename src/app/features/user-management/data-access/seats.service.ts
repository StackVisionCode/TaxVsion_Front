import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  AssignSeatRequest,
  PagedResult,
  ProviderCustomer,
  PurchaseSeatsRequest,
  ReassignSeatRequest,
  ReleaseSeatRequest,
  SeatCheckoutStatusResponse,
  SeatQuoteResponse,
  SeatResponse,
  StartSeatCheckoutRequest,
  StartSeatCheckoutResponse,
} from './seats.model';

/**
 * Asientos: comprarlos y decidir quién ocupa cada uno. Es lo único de la suscripción que sigue en el
 * espacio de trabajo — el resto (plan, cobros, recibos) se gestiona en el Account.
 *
 * Todo va con el JWT que pone el interceptor; el tenant sale del claim, ninguna llamada lo manda en la
 * query. Las mutaciones exigen `SeatsManage` y actor TenantAdmin: sin permiso el backend responde 403.
 */
@Injectable({ providedIn: 'root' })
export class SeatsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantBase();
  }

  getSeats(
    page: number,
    pageSize: number,
    status?: string | null,
    type?: string | null
  ): Observable<PagedResult<SeatResponse>> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (status) {
      params = params.set('status', status);
    }
    if (type) {
      params = params.set('type', type);
    }
    return this.http.get<PagedResult<SeatResponse>>(`${this.base}/seats`, { params });
  }

  /**
   * Cotización server-authoritative (precio unitario + prorrateo a hoy) para comprar `quantity` asientos
   * de un tipo. El precio nunca se calcula en el cliente: sale del catálogo global + período de la base.
   */
  getSeatQuote(seatType: string, quantity: number): Observable<SeatQuoteResponse> {
    const params = new HttpParams().set('seatType', seatType).set('quantity', quantity);
    return this.http.get<SeatQuoteResponse>(`${this.base}/seats/quote`, { params });
  }

  /** 201 con la lista de ids creados (uno por asiento comprado). Cobro OFF-SESSION del método en archivo. */
  purchaseSeats(req: PurchaseSeatsRequest): Observable<string[]> {
    return this.http.post<string[]>(`${this.base}/seats/purchase`, req);
  }

  /** Compra por HOSTED-CHECKOUT (redirect): devuelve la URL del provider a la que navegar. */
  startSeatCheckout(req: StartSeatCheckoutRequest): Observable<StartSeatCheckoutResponse> {
    return this.http.post<StartSeatCheckoutResponse>(`${this.base}/seats/checkout`, req);
  }

  /** Estado de una intención de checkout — se poll-ea al volver del redirect. */
  getSeatCheckoutStatus(intentId: string): Observable<SeatCheckoutStatusResponse> {
    return this.http.get<SeatCheckoutStatusResponse>(`${this.base}/seats/checkout/${intentId}`);
  }

  /** Método de pago del tenant para un provider (para decidir off-session vs redirect). 404 = sin tarjeta. */
  getProviderCustomer(provider: string): Observable<ProviderCustomer> {
    return this.http.get<ProviderCustomer>(`${this.base}/payments-app/provider-customers/${provider}`);
  }

  assignSeat(id: string, req: AssignSeatRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/seats/${id}/assign`, req);
  }

  releaseSeat(id: string, req: ReleaseSeatRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/seats/${id}/release`, req);
  }

  reassignSeat(id: string, req: ReassignSeatRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/seats/${id}/reassign`, req);
  }
}
