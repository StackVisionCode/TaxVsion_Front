import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  PagedResult,
  SendSmsBatchResponse,
  SendSmsMessagesRequest,
  SmsCustomerSummary,
} from './sms.model';

/**
 * Cliente HTTP fino sobre MessagesController (`/sms`, servicio Sms.Api vía Gateway).
 * El servicio SMS solo expone el envío: los webhooks (`/sms/webhooks/...`) son del
 * proveedor (anónimos, firmados) y no se consumen desde el front. El JWT lo pone el
 * interceptor de core/http; el tenant se resuelve server-side desde el token.
 *
 * Requiere el permiso `sms.send` ([HasPermission] en el controller) y está detrás de
 * rate limiting por tenant/usuario ([RateLimit "sms.h.send"]): un 403/429 llega como
 * error normal y se normaliza con toApiError en el store.
 */
@Injectable({ providedIn: 'root' })
export class SmsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  /**
   * POST /sms/messages — envío en lote de 1..N mensajes (tope MaxBatchSize=1000 en el
   * backend). Responde 200 con un resultado POR ITEM: los items inválidos no abortan
   * el lote, vuelven con status "Failed" + errorCode canónico.
   */
  sendMessages(req: SendSmsMessagesRequest): Observable<SendSmsBatchResponse> {
    return this.http.post<SendSmsBatchResponse>(this.api.tenantUrl('/sms/messages'), req);
  }

  /**
   * GET /customers — réplica mínima para el rail de contactos (patrón task-clients,
   * sin imports cross-feature). Devuelve `primaryPhone`, que es lo que necesitamos
   * para saber a quién se puede textear. `NotArchived` excluye los archivados.
   */
  listCustomers(size = 200): Observable<PagedResult<SmsCustomerSummary>> {
    const params = new HttpParams().set('status', 'NotArchived').set('size', size);
    return this.http.get<PagedResult<SmsCustomerSummary>>(this.api.tenantUrl('/customers'), { params });
  }
}
