import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  OpenSupportTicketRequest,
  OpenSupportTicketResult,
  PagedSupportTickets,
  ReopenSupportTicketResult,
} from './support.model';

/**
 * Cliente HTTP de tickets de soporte (Communication vía Gateway,
 * `/communication/support`). Solo cubre lo que puede hacer el customer:
 * abrir ticket, listar los suyos y reabrir uno terminal. Las acciones de
 * agente (claim/resolve/reassign/escalate/close) quedan fuera de esta UI.
 */
@Injectable({ providedIn: 'root' })
export class SupportService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/communication');
  }

  /** POST /support — 201 con `{ ticketId, conversationId }` reales del backend. */
  openTicket(req: OpenSupportTicketRequest): Observable<OpenSupportTicketResult> {
    return this.http.post<OpenSupportTicketResult>(`${this.base}/support`, req);
  }

  /**
   * GET /support — para un actor de tenant cliente el backend resuelve la vista
   * `customer` (tickets abiertos por el usuario actual). `includeClosed=false`
   * solo oculta `Closed` (Resolved sigue apareciendo), así que la lista pide
   * `true` para que los tickets cerrados sigan visibles y reabribles.
   */
  listMyTickets(
    params: { page?: number; size?: number; includeClosed?: boolean } = {},
  ): Observable<PagedSupportTickets> {
    let query = new HttpParams();
    if (params.page) {
      query = query.set('page', params.page);
    }
    if (params.size) {
      query = query.set('size', params.size);
    }
    if (params.includeClosed !== undefined) {
      query = query.set('includeClosed', params.includeClosed);
    }
    return this.http.get<PagedSupportTickets>(`${this.base}/support`, { params: query });
  }

  /**
   * POST /support/:id/reopen — permitido al opener (además del agente asignado
   * y PlatformAdmin) cuando el ticket está Resolved/Closed. Vuelve a Open, o a
   * Claimed si ya tenía agente asignado.
   */
  reopenTicket(ticketId: string, reason?: string): Observable<ReopenSupportTicketResult> {
    const body = reason?.trim() ? { reason: reason.trim() } : {};
    return this.http.post<ReopenSupportTicketResult>(`${this.base}/support/${ticketId}/reopen`, body);
  }
}
