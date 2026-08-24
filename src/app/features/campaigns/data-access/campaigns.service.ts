import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  ApiCampaignStatus,
  CampaignClientSummary,
  CampaignTemplateSummary,
  CreateCampaignRequest,
  EmailCampaignResponse,
  OutboundEmailResponse,
  PagedResult,
  ScheduleCampaignRequest,
  SendTestRequest,
} from './campaigns.model';

/**
 * Cliente HTTP fino sobre EmailCampaignsController (`/notifications/email/campaigns`,
 * servicio Notification vía Gateway). Incluye además dos llamadas replicadas de otros
 * controllers (patrón task-service, sin imports cross-feature):
 *  - GET /notifications/email/templates → picker de plantilla + resolución de nombres.
 *  - GET /customers → destinatarios cuando la audiencia es "All active clients".
 */
@Injectable({ providedIn: 'root' })
export class CampaignsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/notifications/email/campaigns');
  }

  // ---------- Campañas ----------

  /** GET /notifications/email/campaigns — paginado con `page`/`size` (size máx 100). */
  list(params: { status?: ApiCampaignStatus; page?: number; size?: number }): Observable<PagedResult<EmailCampaignResponse>> {
    let query = new HttpParams();
    if (params.status) {
      query = query.set('status', params.status);
    }
    if (params.page) {
      query = query.set('page', params.page);
    }
    if (params.size) {
      query = query.set('size', params.size);
    }
    return this.http.get<PagedResult<EmailCampaignResponse>>(this.base, { params: query });
  }

  getById(id: string): Observable<EmailCampaignResponse> {
    return this.http.get<EmailCampaignResponse>(`${this.base}/${id}`);
  }

  /** POST /notifications/email/campaigns — crea el Draft con destinatarios explícitos. */
  create(req: CreateCampaignRequest): Observable<EmailCampaignResponse> {
    return this.http.post<EmailCampaignResponse>(this.base, req);
  }

  /**
   * POST /notifications/email/campaigns/{id}/schedule — Draft → Scheduled. Captura la
   * plantilla publicada (falla con EmailTemplate.NotPublished si no hay versión activa).
   * `scheduledAtUtc: null` programa para ahora.
   */
  schedule(id: string, req: ScheduleCampaignRequest): Observable<EmailCampaignResponse> {
    return this.http.post<EmailCampaignResponse>(`${this.base}/${id}/schedule`, req);
  }

  /** POST /notifications/email/campaigns/{id}/send-test — 202 con el correo encolado. */
  sendTest(id: string, req: SendTestRequest): Observable<OutboundEmailResponse> {
    return this.http.post<OutboundEmailResponse>(`${this.base}/${id}/send-test`, req);
  }

  /** POST /notifications/email/campaigns/{id}/cancel — 204; inválido en Completed/Cancelled. */
  cancel(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/cancel`, {});
  }

  // ---------- Llamadas replicadas de otros controllers ----------

  /** GET /notifications/email/templates — lista completa (sin paginar) de plantillas System+Tenant. */
  listTemplates(): Observable<CampaignTemplateSummary[]> {
    return this.http.get<CampaignTemplateSummary[]>(this.api.tenantUrl('/notifications/email/templates'));
  }

  /** GET /customers — lote de clientes no archivados para armar la audiencia "active clients". */
  listClients(size = 200): Observable<PagedResult<CampaignClientSummary>> {
    const params = new HttpParams().set('status', 'NotArchived').set('size', size);
    return this.http.get<PagedResult<CampaignClientSummary>>(this.api.tenantUrl('/customers'), { params });
  }
}
