import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  EstimateView,
  LedgerEntryView,
  PagedResult,
  PerChannelUnits,
  RatesView,
  TopUpCheckoutView,
  TopUpRequest,
  TopUpView,
  WalletView,
} from './wallet.model';

/**
 * Cliente HTTP fino sobre el servicio `TaxVision.Wallet` (vía Gateway). Monedero prepago por tenant:
 * saldo (`/wallet`), historial (`/wallet/transactions`), recargas (`/wallet/top-ups`), tarifas
 * (`/wallet/rates`) y estimación de costo (`/wallet/estimate`). El cobro (reserve/consume) NO tiene
 * endpoint público — ocurre por el PEP interno al enviar campañas.
 */
@Injectable({ providedIn: 'root' })
export class WalletService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private url(path: string): string {
    return this.api.tenantUrl(path);
  }

  getWallet(): Observable<WalletView> {
    return this.http.get<WalletView>(this.url('/wallet'));
  }

  listTransactions(page?: number, size?: number): Observable<PagedResult<LedgerEntryView>> {
    let q = new HttpParams();
    if (page) q = q.set('page', page);
    if (size) q = q.set('size', size);
    return this.http.get<PagedResult<LedgerEntryView>>(this.url('/wallet/transactions'), { params: q });
  }

  getRates(): Observable<RatesView> {
    return this.http.get<RatesView>(this.url('/wallet/rates'));
  }

  /** Costo estimado de un envío (unidades×tarifa) vs saldo — SIN efectos. */
  estimate(units: PerChannelUnits): Observable<EstimateView> {
    return this.http.post<EstimateView>(this.url('/wallet/estimate'), units);
  }

  /** Inicia una recarga por checkout hosteado: crea la orden y devuelve la URL del proveedor para redirigir. */
  createTopUp(req: TopUpRequest): Observable<TopUpCheckoutView> {
    return this.http.post<TopUpCheckoutView>(this.url('/wallet/top-ups'), req);
  }

  getTopUp(id: string): Observable<TopUpView> {
    return this.http.get<TopUpView>(this.url(`/wallet/top-ups/${id}`));
  }
}
