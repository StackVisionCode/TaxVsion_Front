import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { InvoiceCheckout, PayResult } from './invoice-checkout.model';

/**
 * Checkout público de una factura (sin login; el token del path es la única prueba de posesión).
 * Consume la superficie pública de PaymentClient a través del gateway.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceCheckoutService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** Datos del checkout: monto, moneda, tenant y los métodos de pago ACTIVOS del tenant. */
  getCheckout(token: string): Observable<InvoiceCheckout> {
    return this.http.get<InvoiceCheckout>(`${this.base}/payments-client/checkout/${token}`);
  }

  /** Cobra: el frontend ya tokenizó el método con el SDK del proveedor; manda solo la referencia opaca. */
  pay(
    token: string,
    body: { provider: string; providerPaymentMethodToken: string; receiptEmail?: string }
  ): Observable<PayResult> {
    return this.http.post<PayResult>(`${this.base}/payments-client/checkout/${token}/pay`, body);
  }
}
