import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  ApiCampaignStatus,
  ApiChannel,
  CampaignResponse,
  CampaignRunResponse,
  CampaignScheduleResponse,
  ContactListResponse,
  ContactResponse,
  CreateCampaignRequest,
  CreateContactListRequest,
  CreateContactRequest,
  CreateSenderProfileRequest,
  EmailTemplateSummary,
  ImportContactsRequest,
  ImportContactsResponse,
  PagedResult,
  ScheduleAction,
  ScheduleCampaignRequest,
  SendNowRequest,
  SendToAudienceRequest,
  SenderProfileResponse,
  SetCampaignSenderRequest,
  SetContactOptOutRequest,
} from './campaigns.model';

/**
 * Cliente HTTP fino sobre el servicio orquestador `TaxVision.Campaigns` (vía Gateway). Cubre los
 * cuatro recursos: campañas + runs + agendado (`/campaigns`), contactos (`/contacts`), listas
 * (`/contact-lists`) y remitentes (`/sender-profiles`). Todo requiere `campaigns.manage` (staff).
 */
@Injectable({ providedIn: 'root' })
export class CampaignsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private url(path: string): string {
    return this.api.tenantUrl(path);
  }

  private paged(page?: number, size?: number): HttpParams {
    let q = new HttpParams();
    if (page) q = q.set('page', page);
    if (size) q = q.set('size', size);
    return q;
  }

  // ---------- Campaigns ----------

  listCampaigns(p: { status?: ApiCampaignStatus; page?: number; size?: number } = {}): Observable<PagedResult<CampaignResponse>> {
    let q = this.paged(p.page, p.size);
    if (p.status) q = q.set('status', p.status);
    return this.http.get<PagedResult<CampaignResponse>>(this.url('/campaigns'), { params: q });
  }

  getCampaign(id: string): Observable<CampaignResponse> {
    return this.http.get<CampaignResponse>(this.url(`/campaigns/${id}`));
  }

  createCampaign(req: CreateCampaignRequest): Observable<CampaignResponse> {
    return this.http.post<CampaignResponse>(this.url('/campaigns'), req);
  }

  updateCampaign(id: string, req: CreateCampaignRequest): Observable<CampaignResponse> {
    return this.http.put<CampaignResponse>(this.url(`/campaigns/${id}`), req);
  }

  markReady(id: string): Observable<CampaignResponse> {
    return this.http.post<CampaignResponse>(this.url(`/campaigns/${id}/ready`), {});
  }

  revertToDraft(id: string): Observable<CampaignResponse> {
    return this.http.post<CampaignResponse>(this.url(`/campaigns/${id}/revise`), {});
  }

  archiveCampaign(id: string): Observable<CampaignResponse> {
    return this.http.post<CampaignResponse>(this.url(`/campaigns/${id}/archive`), {});
  }

  deleteCampaign(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/campaigns/${id}`));
  }

  setSender(id: string, req: SetCampaignSenderRequest): Observable<CampaignResponse> {
    return this.http.post<CampaignResponse>(this.url(`/campaigns/${id}/senders`), req);
  }

  sendNow(id: string, req: SendNowRequest): Observable<CampaignRunResponse> {
    return this.http.post<CampaignRunResponse>(this.url(`/campaigns/${id}/send-now`), req);
  }

  sendToAudience(id: string, req: SendToAudienceRequest): Observable<CampaignRunResponse> {
    return this.http.post<CampaignRunResponse>(this.url(`/campaigns/${id}/send-to-audience`), req);
  }

  listRuns(id: string, page?: number, size?: number): Observable<PagedResult<CampaignRunResponse>> {
    return this.http.get<PagedResult<CampaignRunResponse>>(this.url(`/campaigns/${id}/runs`), { params: this.paged(page, size) });
  }

  getRun(runId: string): Observable<CampaignRunResponse> {
    return this.http.get<CampaignRunResponse>(this.url(`/campaigns/runs/${runId}`));
  }

  // ---------- Schedules ----------

  schedule(id: string, req: ScheduleCampaignRequest): Observable<CampaignScheduleResponse> {
    return this.http.post<CampaignScheduleResponse>(this.url(`/campaigns/${id}/schedule`), req);
  }

  listSchedules(id: string, page?: number, size?: number): Observable<PagedResult<CampaignScheduleResponse>> {
    return this.http.get<PagedResult<CampaignScheduleResponse>>(this.url(`/campaigns/${id}/schedules`), {
      params: this.paged(page, size),
    });
  }

  setScheduleState(scheduleId: string, action: ScheduleAction): Observable<CampaignScheduleResponse> {
    return this.http.post<CampaignScheduleResponse>(this.url(`/campaigns/schedules/${scheduleId}/${action}`), {});
  }

  // ---------- Contacts ----------

  listContacts(page?: number, size?: number): Observable<PagedResult<ContactResponse>> {
    return this.http.get<PagedResult<ContactResponse>>(this.url('/contacts'), { params: this.paged(page, size) });
  }

  createContact(req: CreateContactRequest): Observable<ContactResponse> {
    return this.http.post<ContactResponse>(this.url('/contacts'), req);
  }

  updateContact(id: string, req: CreateContactRequest): Observable<ContactResponse> {
    return this.http.put<ContactResponse>(this.url(`/contacts/${id}`), req);
  }

  setContactOptOut(id: string, req: SetContactOptOutRequest): Observable<ContactResponse> {
    return this.http.post<ContactResponse>(this.url(`/contacts/${id}/opt-out`), req);
  }

  // ---------- Contact lists ----------

  listContactLists(page?: number, size?: number): Observable<PagedResult<ContactListResponse>> {
    return this.http.get<PagedResult<ContactListResponse>>(this.url('/contact-lists'), { params: this.paged(page, size) });
  }

  createContactList(req: CreateContactListRequest): Observable<ContactListResponse> {
    return this.http.post<ContactListResponse>(this.url('/contact-lists'), req);
  }

  updateContactList(id: string, req: CreateContactListRequest): Observable<ContactListResponse> {
    return this.http.put<ContactListResponse>(this.url(`/contact-lists/${id}`), req);
  }

  deleteContactList(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/contact-lists/${id}`));
  }

  deleteContact(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/contacts/${id}`));
  }

  importContacts(listId: string, req: ImportContactsRequest): Observable<ImportContactsResponse> {
    return this.http.post<ImportContactsResponse>(this.url(`/contact-lists/${listId}/import`), req);
  }

  addListMember(listId: string, contactId: string): Observable<ContactListResponse> {
    return this.http.post<ContactListResponse>(this.url(`/contact-lists/${listId}/members`), { contactId });
  }

  // ---------- Sender profiles ----------

  listSenders(channel?: ApiChannel, page?: number, size?: number): Observable<PagedResult<SenderProfileResponse>> {
    let q = this.paged(page, size);
    if (channel) q = q.set('channel', channel);
    return this.http.get<PagedResult<SenderProfileResponse>>(this.url('/sender-profiles'), { params: q });
  }

  createSender(req: CreateSenderProfileRequest): Observable<SenderProfileResponse> {
    return this.http.post<SenderProfileResponse>(this.url('/sender-profiles'), req);
  }

  setSenderStatus(id: string, active: boolean): Observable<SenderProfileResponse> {
    return this.http.post<SenderProfileResponse>(this.url(`/sender-profiles/${id}/status`), { active });
  }

  // ---------- Email templates (para el picker del body; controller de Notification) ----------

  /** GET /notifications/email/templates — lista completa (System + Tenant), sin paginar. */
  listTemplates(): Observable<EmailTemplateSummary[]> {
    return this.http.get<EmailTemplateSummary[]>(this.url('/notifications/email/templates'));
  }
}
