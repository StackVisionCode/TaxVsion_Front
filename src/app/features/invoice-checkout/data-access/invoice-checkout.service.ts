import { Injectable, inject } from '@angular/core';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { Observable, defer } from 'rxjs';
import { ApiConfigService, tenantSlugFromHost } from '@core/config/api-config.service';
import { environment } from '@env/environment';
import { InvoiceCheckout, PayResult } from './invoice-checkout.model';

/**
 * Checkout público de una factura (sin login; el token del path es la única prueba de posesión).
 * Consume la superficie pública de PaymentClient a través del gateway.
 *
 * Dos particularidades, las mismas que en el recorrido público de firma:
 *
 * 1. **Sin interceptores** (`HttpBackend`): quien paga no tiene sesión, y si un empleado
 *    abriera el enlace en su navegador no debe colarse su `Authorization` en un endpoint
 *    anónimo ni dispararse el refresh/redirect a /login del `errorInterceptor`.
 *
 * 2. **Base derivada del HOST.** `tenantBase()` lanza en producción cuando no hay oficina
 *    resuelta, y el cliente que paga nunca inició sesión: la página se quedaba colgada en
 *    "cargando" para siempre, porque además la excepción era síncrona y no llegaba al
 *    `error` del subscribe. Ahora manda el subdominio desde el que se abrió el enlace y
 *    todo va dentro de `defer`, de modo que cualquier fallo viaje por el Observable.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceCheckoutService {
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    if (!environment.production) {
      return this.api.tenantUrl('/payments-client');
    }
    const slug = tenantSlugFromHost();
    if (slug) {
      return `https://${slug}.${environment.baseDomain}/payments-client`;
    }
    // Enlace servido fuera del subdominio de la oficina: se intenta la sesión y, si
    // tampoco hay, el host de sistema (el token del path identifica la factura).
    try {
      return this.api.tenantUrl('/payments-client');
    } catch {
      return this.api.systemUrl('/payments-client');
    }
  }

  /** Datos del checkout: monto, moneda, tenant y los métodos de pago ACTIVOS del tenant. */
  getCheckout(token: string): Observable<InvoiceCheckout> {
    return defer(() =>
      this.http.get<InvoiceCheckout>(`${this.base}/checkout/${encodeURIComponent(token)}`),
    );
  }

  /** Cobra: el frontend ya tokenizó el método con el SDK del proveedor; manda solo la referencia opaca. */
  pay(
    token: string,
    body: { provider: string; providerPaymentMethodToken: string; receiptEmail?: string }
  ): Observable<PayResult> {
    return defer(() =>
      this.http.post<PayResult>(`${this.base}/checkout/${encodeURIComponent(token)}/pay`, body),
    );
  }
}
