import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  AttachFileToDraftRequest,
  AttachmentDownloadUrlResult,
  AttachmentSummary,
  AutoSaveDraftRequest,
  DownloadAttachmentResult,
  DraftDetail,
  DraftListItem,
  InitiateOAuthConnectResult,
  MailAccount,
  MailCustomerSummary,
  MessageBody,
  MessageSummary,
  PagedResult,
  SendDraftResult,
  StartReplyResult,
  ThreadSummary,
} from './mail.model';

/**
 * Cliente HTTP fino del módulo Mail sobre dos servicios del Gateway:
 * - Connectors.Api (`/connectors`): cuentas de buzón (OAuth Gmail/Graph, reauth).
 * - Correspondence.Api (`/correspondence`): hilos por customer, mensajes, body en vivo,
 *   adjuntos bajo demanda y compose (drafts + send síncrono vía Postmaster).
 * Más el subset de GET /customers para el picker de cliente (réplica, sin import cross-feature).
 * El JWT viaja por el interceptor global; acá no se agregan headers.
 */
@Injectable({ providedIn: 'root' })
export class MailService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get connectors(): string {
    return this.api.tenantUrl('/connectors');
  }

  private get correspondence(): string {
    return this.api.tenantUrl('/correspondence');
  }

  // ---------- Connectors: cuentas de buzón ----------

  listAccounts(): Observable<MailAccount[]> {
    return this.http.get<MailAccount[]>(`${this.connectors}/accounts`);
  }

  /** El resultado NO se consume por fetch: hay que redirigir el navegador a authorizationUrl. */
  initiateOAuthConnect(providerCode: 'Gmail' | 'Graph'): Observable<InitiateOAuthConnectResult> {
    return this.http.post<InitiateOAuthConnectResult>(`${this.connectors}/accounts`, { providerCode });
  }

  /** Reintenta el watch de una cuenta en estado Error. 204. */
  reauthAccount(accountId: string): Observable<void> {
    return this.http.post<void>(`${this.connectors}/accounts/${accountId}/reauth`, {});
  }

  // ---------- Customer: picker de cliente ----------

  searchCustomers(term: string, size = 200): Observable<PagedResult<MailCustomerSummary>> {
    let params = new HttpParams().set('status', 'NotArchived').set('size', size);
    if (term.trim()) {
      params = params.set('term', term.trim());
    }
    return this.http.get<PagedResult<MailCustomerSummary>>(this.api.tenantUrl('/customers'), { params });
  }

  // ---------- Correspondence: hilos ----------

  listThreads(customerId: string, page: number, size: number): Observable<PagedResult<ThreadSummary>> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<PagedResult<ThreadSummary>>(
      `${this.correspondence}/customers/${customerId}/threads`,
      { params },
    );
  }

  /** Inbound + outbound mezclados, cronológico ascendente (más viejo primero). */
  listThreadMessages(threadId: string, page: number, size: number): Observable<PagedResult<MessageSummary>> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<PagedResult<MessageSummary>>(
      `${this.correspondence}/threads/${threadId}/messages`,
      { params },
    );
  }

  /** Archiva el hilo completo (no hay unarchive ni delete en el backend). 204. */
  archiveThread(threadId: string): Observable<void> {
    return this.http.post<void>(`${this.correspondence}/threads/${threadId}/archive`, {});
  }

  // ---------- Correspondence: mensajes (solo inbound) ----------

  /** Body pedido en vivo a Connectors — puede tardar/fallar si el buzón externo no responde. */
  getMessageBody(messageId: string): Observable<MessageBody> {
    return this.http.get<MessageBody>(`${this.correspondence}/messages/${messageId}/body`);
  }

  listMessageAttachments(messageId: string): Observable<AttachmentSummary[]> {
    return this.http.get<AttachmentSummary[]>(`${this.correspondence}/messages/${messageId}/attachments`);
  }

  /** Dispara la descarga bajo demanda hacia CloudStorage. Idempotente. */
  requestAttachmentDownload(messageId: string, attachmentId: string): Observable<DownloadAttachmentResult> {
    return this.http.post<DownloadAttachmentResult>(
      `${this.correspondence}/messages/${messageId}/attachments/${attachmentId}/download`,
      {},
    );
  }

  /** URL presignada del adjunto ya descargado. 409 mientras no esté listo. */
  getAttachmentDownloadUrl(messageId: string, attachmentId: string): Observable<AttachmentDownloadUrlResult> {
    return this.http.get<AttachmentDownloadUrlResult>(
      `${this.correspondence}/messages/${messageId}/attachments/${attachmentId}/download-url`,
    );
  }

  /** Get-or-create del reply abierto sobre un mensaje inbound. */
  startReply(messageId: string, accountId: string): Observable<StartReplyResult> {
    return this.http.post<StartReplyResult>(
      `${this.correspondence}/messages/${messageId}/reply/draft`,
      { accountId },
    );
  }

  // ---------- Correspondence: drafts ----------

  listDrafts(customerId: string, page: number, size: number): Observable<PagedResult<DraftListItem>> {
    const params = new HttpParams().set('customerId', customerId).set('page', page).set('size', size);
    return this.http.get<PagedResult<DraftListItem>>(`${this.correspondence}/drafts`, { params });
  }

  createDraft(customerId: string, accountId: string): Observable<{ draftId: string }> {
    return this.http.post<{ draftId: string }>(`${this.correspondence}/drafts`, { customerId, accountId });
  }

  getDraft(draftId: string): Observable<DraftDetail> {
    return this.http.get<DraftDetail>(`${this.correspondence}/drafts/${draftId}`);
  }

  /** PATCH parcial (campo null/ausente no pisa lo guardado). 204. */
  autoSaveDraft(draftId: string, body: AutoSaveDraftRequest): Observable<void> {
    return this.http.patch<void>(`${this.correspondence}/drafts/${draftId}`, body);
  }

  /** Descarta el draft (Discarded). 204. */
  discardDraft(draftId: string): Observable<void> {
    return this.http.delete<void>(`${this.correspondence}/drafts/${draftId}`);
  }

  /** El archivo ya fue subido a CloudStorage; acá solo viaja la referencia. 204. */
  attachFileToDraft(draftId: string, body: AttachFileToDraftRequest): Observable<void> {
    return this.http.post<void>(`${this.correspondence}/drafts/${draftId}/attachments`, body);
  }

  removeDraftAttachment(draftId: string, fileId: string): Observable<void> {
    return this.http.delete<void>(`${this.correspondence}/drafts/${draftId}/attachments/${fileId}`);
  }

  /** Síncrono y bloqueante: no responde hasta el resultado real del envío (Postmaster). */
  sendDraft(draftId: string): Observable<SendDraftResult> {
    return this.http.post<SendDraftResult>(`${this.correspondence}/drafts/${draftId}/send`, {});
  }
}
