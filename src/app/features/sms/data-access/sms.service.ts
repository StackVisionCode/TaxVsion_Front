import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { readOnlyRequestContext } from '@core/http/read-only-request';
import {
  PagedResult,
  SendSmsBatchResponse,
  SendSmsMessagesRequest,
  SetSmsConsentRequest,
  SmsConversationSummary,
  SmsMessageDetail,
  SmsMessageSummary,
  SmsOptOutFilter,
  SmsOptOutSummary,
  SmsStats,
  SmsStatusFilter,
} from './sms.model';

/** Filtros del listado de mensajes (query params server-side). */
export interface SmsMessageQuery {
  customerId?: string | null;
  status?: SmsStatusFilter;
  term?: string | null;
  from?: string | null;
  to?: string | null;
  page?: number;
  size?: number;
}

/** Filtros de la vista de conversaciones (agrupada por cliente). */
export interface SmsConversationQuery {
  term?: string | null;
  page?: number;
  size?: number;
}

/** Filtros del listado de bajas. */
export interface SmsOptOutQuery {
  status?: SmsOptOutFilter;
  term?: string | null;
  page?: number;
  size?: number;
}

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
   * Una fila por cliente (último mensaje + total del hilo), paginado (`sms.read`). Con término →
   * POST /sms/conversations/search (nombre/teléfono/email del cliente en el cuerpo, no en la URL que
   * acaba en los logs del Gateway); sin término → GET /sms/conversations.
   */
  listConversations(query: SmsConversationQuery): Observable<PagedResult<SmsConversationSummary>> {
    const term = query.term?.trim();
    if (term) {
      return this.searchByBody<SmsConversationSummary>('/sms/conversations/search', {
        term,
        page: query.page || undefined,
        size: query.size || undefined,
      });
    }
    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page);
    if (query.size) params = params.set('size', query.size);
    return this.http.get<PagedResult<SmsConversationSummary>>(this.api.tenantUrl('/sms/conversations'), { params });
  }

  /** Historial paginado + filtros (`sms.read`). Con término → POST /sms/messages/search; sin él → GET /sms/messages. */
  listMessages(query: SmsMessageQuery): Observable<PagedResult<SmsMessageSummary>> {
    const status = query.status && query.status !== 'All' ? query.status : undefined;
    const term = query.term?.trim();
    if (term) {
      return this.searchByBody<SmsMessageSummary>('/sms/messages/search', {
        customerId: query.customerId || undefined,
        status,
        term,
        from: query.from || undefined,
        to: query.to || undefined,
        page: query.page || undefined,
        size: query.size || undefined,
      });
    }
    let params = new HttpParams();
    if (query.customerId) params = params.set('customerId', query.customerId);
    if (status) params = params.set('status', status);
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.page) params = params.set('page', query.page);
    if (query.size) params = params.set('size', query.size);
    return this.http.get<PagedResult<SmsMessageSummary>>(this.api.tenantUrl('/sms/messages'), { params });
  }

  /** GET /sms/messages/{id} — detalle con línea de tiempo de estado. */
  getMessage(id: string): Observable<SmsMessageDetail> {
    return this.http.get<SmsMessageDetail>(this.api.tenantUrl(`/sms/messages/${id}`));
  }

  /** GET /sms/messages/stats — conteos agregados (ventana opcional; backend default 30d). */
  getStats(from?: string | null, to?: string | null): Observable<SmsStats> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<SmsStats>(this.api.tenantUrl('/sms/messages/stats'), { params });
  }

  /** Bajas paginadas + filtros. Con término → POST /sms/optouts/search; sin él → GET /sms/optouts. */
  listOptOuts(query: SmsOptOutQuery): Observable<PagedResult<SmsOptOutSummary>> {
    const status = query.status && query.status !== 'All' ? query.status : undefined;
    const term = query.term?.trim();
    if (term) {
      return this.searchByBody<SmsOptOutSummary>('/sms/optouts/search', {
        status,
        term,
        page: query.page || undefined,
        size: query.size || undefined,
      });
    }
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    if (query.page) params = params.set('page', query.page);
    if (query.size) params = params.set('size', query.size);
    return this.http.get<PagedResult<SmsOptOutSummary>>(this.api.tenantUrl('/sms/optouts'), { params });
  }

  /** POST /sms/optouts — gestión manual del consentimiento (admin, `sms.manage`). */
  setConsent(req: SetSmsConsentRequest): Observable<SmsOptOutSummary> {
    return this.http.post<SmsOptOutSummary>(this.api.tenantUrl('/sms/optouts'), req);
  }

  /** POST de solo lectura: conserva el reintento silencioso ante 429/503 del errorInterceptor. */
  private searchByBody<T>(path: string, body: object): Observable<PagedResult<T>> {
    return this.http.post<PagedResult<T>>(this.api.tenantUrl(path), body, { context: readOnlyRequestContext() });
  }
}
