import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { CampaignsService } from './campaigns.service';
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
  ScheduleAction,
  ScheduleCampaignRequest,
  SendToAudienceRequest,
  SenderProfileResponse,
  SetCampaignSenderRequest,
  SetContactOptOutRequest,
} from './campaigns.model';

const PAGE = 100;

/**
 * Store del módulo Campaigns (servicio orquestador `TaxVision.Campaigns`). Guarda el estado de
 * lectura de los cuatro recursos como signals y expone acciones que refrescan el recurso afectado.
 * Búsqueda/filtro por estado viven en el cliente sobre la lista completa (paginada en un lote).
 */
@Injectable({ providedIn: 'root' })
export class CampaignsStore {
  private readonly service = inject(CampaignsService);

  // ---------- campaigns ----------
  private readonly _campaigns = signal<CampaignResponse[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _actionError = signal<string | null>(null);
  private readonly _statusFilter = signal<ApiCampaignStatus | 'all'>('all');
  private readonly _search = signal('');
  private initialized = false;

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly actionError = this._actionError.asReadonly();
  readonly statusFilter = this._statusFilter.asReadonly();

  readonly campaigns = computed<CampaignResponse[]>(() => {
    const q = this._search().trim().toLowerCase();
    const s = this._statusFilter();
    return this._campaigns().filter(c => (s === 'all' || c.status === s) && (!q || c.name.toLowerCase().includes(q)));
  });
  readonly totalCount = computed(() => this._campaigns().length);

  // ---------- supporting resources ----------
  private readonly _lists = signal<ContactListResponse[]>([]);
  private readonly _contacts = signal<ContactResponse[]>([]);
  private readonly _senders = signal<SenderProfileResponse[]>([]);
  private readonly _runs = signal<CampaignRunResponse[]>([]);
  private readonly _schedules = signal<CampaignScheduleResponse[]>([]);
  private readonly _templates = signal<EmailTemplateSummary[]>([]);
  readonly lists = this._lists.asReadonly();
  readonly contacts = this._contacts.asReadonly();
  readonly senders = this._senders.asReadonly();
  readonly runs = this._runs.asReadonly();
  readonly schedules = this._schedules.asReadonly();
  readonly templates = this._templates.asReadonly();

  // ---------- init ----------
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.loadCampaigns();
    this.loadLists();
    this.loadSenders();
    this.loadTemplates();
  }

  loadTemplates(): void {
    this.service.listTemplates().subscribe({ next: t => this._templates.set(t ?? []), error: () => {} });
  }

  setStatusFilter(s: ApiCampaignStatus | 'all'): void {
    this._statusFilter.set(s);
  }
  setSearch(q: string): void {
    this._search.set(q);
  }
  clearActionError(): void {
    this._actionError.set(null);
  }

  // ---------- loads ----------
  loadCampaigns(): void {
    this._loading.set(true);
    this._error.set(null);
    this.service.listCampaigns({ size: PAGE }).subscribe({
      next: p => {
        this._campaigns.set(p.items);
        this._loading.set(false);
      },
      error: e => {
        this._error.set(toApiError(e).message);
        this._loading.set(false);
      },
    });
  }
  loadLists(): void {
    this.service.listContactLists(1, PAGE).subscribe({ next: p => this._lists.set(p.items), error: () => {} });
  }
  loadContacts(): void {
    this.service.listContacts(1, PAGE).subscribe({ next: p => this._contacts.set(p.items), error: () => {} });
  }
  loadSenders(): void {
    this.service.listSenders(undefined, 1, PAGE).subscribe({ next: p => this._senders.set(p.items), error: () => {} });
  }
  loadRuns(campaignId: string): void {
    this._runs.set([]);
    this.service.listRuns(campaignId, 1, 50).subscribe({ next: p => this._runs.set(p.items), error: () => {} });
  }
  loadSchedules(campaignId: string): void {
    this.service.listSchedules(campaignId, 1, 50).subscribe({ next: p => this._schedules.set(p.items), error: () => {} });
  }

  // ---------- actions (return Observable so the page can toast/close) ----------
  createCampaign(req: CreateCampaignRequest): Observable<CampaignResponse> {
    return this.act(this.service.createCampaign(req), () => this.loadCampaigns());
  }
  updateCampaign(id: string, req: CreateCampaignRequest): Observable<CampaignResponse> {
    return this.act(this.service.updateCampaign(id, req), () => this.loadCampaigns());
  }
  markReady(id: string): Observable<CampaignResponse> {
    return this.act(this.service.markReady(id), () => this.loadCampaigns());
  }
  revertToDraft(id: string): Observable<CampaignResponse> {
    return this.act(this.service.revertToDraft(id), () => this.loadCampaigns());
  }
  archiveCampaign(id: string): Observable<CampaignResponse> {
    return this.act(this.service.archiveCampaign(id), () => this.loadCampaigns());
  }
  deleteCampaign(id: string): Observable<void> {
    return this.act(this.service.deleteCampaign(id), () => this.loadCampaigns());
  }
  setCampaignSender(id: string, req: SetCampaignSenderRequest): Observable<CampaignResponse> {
    return this.act(this.service.setSender(id, req), () => this.loadCampaigns());
  }
  sendToAudience(id: string, req: SendToAudienceRequest): Observable<CampaignRunResponse> {
    return this.act(this.service.sendToAudience(id, req), () => this.loadRuns(id));
  }
  schedule(id: string, req: ScheduleCampaignRequest): Observable<CampaignScheduleResponse> {
    return this.act(this.service.schedule(id, req), () => this.loadSchedules(id));
  }
  setScheduleState(campaignId: string, scheduleId: string, action: ScheduleAction): Observable<CampaignScheduleResponse> {
    return this.act(this.service.setScheduleState(scheduleId, action), () => this.loadSchedules(campaignId));
  }
  createContact(req: CreateContactRequest): Observable<ContactResponse> {
    return this.act(this.service.createContact(req), () => this.loadContacts());
  }
  updateContact(id: string, req: CreateContactRequest): Observable<ContactResponse> {
    return this.act(this.service.updateContact(id, req), () => this.loadContacts());
  }
  setContactOptOut(id: string, req: SetContactOptOutRequest): Observable<ContactResponse> {
    return this.act(this.service.setContactOptOut(id, req), () => this.loadContacts());
  }
  createContactList(req: CreateContactListRequest): Observable<ContactListResponse> {
    return this.act(this.service.createContactList(req), () => this.loadLists());
  }
  updateContactList(id: string, req: CreateContactListRequest): Observable<ContactListResponse> {
    return this.act(this.service.updateContactList(id, req), () => this.loadLists());
  }
  deleteContactList(id: string): Observable<void> {
    return this.act(this.service.deleteContactList(id), () => this.loadLists());
  }
  deleteContact(id: string): Observable<void> {
    return this.act(this.service.deleteContact(id), () => this.loadContacts());
  }
  importContacts(listId: string, req: ImportContactsRequest): Observable<ImportContactsResponse> {
    return this.act(this.service.importContacts(listId, req), () => this.loadLists());
  }
  createSender(req: CreateSenderProfileRequest): Observable<SenderProfileResponse> {
    return this.act(this.service.createSender(req), () => this.loadSenders());
  }
  setSenderStatus(id: string, active: boolean): Observable<SenderProfileResponse> {
    return this.act(this.service.setSenderStatus(id, active), () => this.loadSenders());
  }

  /** Envuelve una acción: limpia el banner, refresca el recurso en éxito y captura el error en el banner. */
  private act<T>(source: Observable<T>, onOk: () => void): Observable<T> {
    this._actionError.set(null);
    return source.pipe(
      tap({
        next: () => onOk(),
        error: e => this._actionError.set(toApiError(e).message),
      }),
    );
  }

  channelsWithoutSender = (c: CampaignResponse): ApiChannel[] =>
    c.channels.filter(ch => !c.senders.some(s => s.channel === ch));
}
