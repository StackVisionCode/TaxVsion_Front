import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { CampaignsService } from './campaigns.service';
import {
  ApiCampaignStatus,
  ApiChannel,
  AudiencePreviewResponse,
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
  CampaignTemplateRequest,
  CampaignTemplateResponse,
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

/** Las listas que acompañan a la de campañas. Cada una se pide aparte y puede fallar sola. */
export type CampaignSubResource = 'lists' | 'contacts' | 'senders' | 'runs' | 'schedules' | 'templates';

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
  private readonly _campaignTemplates = signal<CampaignTemplateResponse[]>([]);
  /**
   * B5 — por qué falló cada sub-lista, o null si está bien.
   *
   * Las seis se cargaban con `error: () => {}`: un 403 dejaba la lista vacía y la pantalla decía
   * "no hay remitentes" cuando lo cierto era "no pudimos preguntarlo". Un vacío inventado es peor
   * que un error: el usuario no sabe que tiene que hacer algo.
   */
  private readonly _subErrors = signal<Readonly<Record<CampaignSubResource, string | null>>>({
    lists: null,
    contacts: null,
    senders: null,
    runs: null,
    schedules: null,
    templates: null,
  });
  readonly subErrors = this._subErrors.asReadonly();

  private failed(resource: CampaignSubResource) {
    return (e: unknown) => this._subErrors.update(all => ({ ...all, [resource]: toApiError(e).message }));
  }

  private loaded(resource: CampaignSubResource) {
    this._subErrors.update(all => ({ ...all, [resource]: null }));
  }

  readonly lists = this._lists.asReadonly();
  readonly contacts = this._contacts.asReadonly();
  readonly senders = this._senders.asReadonly();
  readonly runs = this._runs.asReadonly();
  readonly schedules = this._schedules.asReadonly();
  readonly templates = this._templates.asReadonly();
  readonly campaignTemplates = this._campaignTemplates.asReadonly();

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
    this.service.listTemplates().subscribe({
      next: t => {
        this._templates.set(t ?? []);
        this.loaded('templates');
      },
      error: this.failed('templates'),
    });
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
    this.service.listContactLists(1, PAGE).subscribe({
      next: p => {
        this._lists.set(p.items);
        this.loaded('lists');
      },
      error: this.failed('lists'),
    });
  }
  loadContacts(): void {
    this.service.listContacts(1, PAGE).subscribe({
      next: p => {
        this._contacts.set(p.items);
        this.loaded('contacts');
      },
      error: this.failed('contacts'),
    });
  }
  loadSenders(): void {
    this.service.listSenders(undefined, 1, PAGE).subscribe({
      next: p => {
        this._senders.set(p.items);
        this.loaded('senders');
      },
      error: this.failed('senders'),
    });
  }
  loadRuns(campaignId: string): void {
    this._runs.set([]);
    this.service.listRuns(campaignId, 1, 50).subscribe({
      next: p => {
        this._runs.set(p.items);
        this.loaded('runs');
      },
      error: this.failed('runs'),
    });
  }
  loadSchedules(campaignId: string): void {
    this.service.listSchedules(campaignId, 1, 50).subscribe({
      next: p => {
        this._schedules.set(p.items);
        this.loaded('schedules');
      },
      error: this.failed('schedules'),
    });
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
  /** Estimado de audiencia (sin efectos) — el componente lo cotiza en el Wallet. */
  previewAudience(id: string, req: SendToAudienceRequest): Observable<AudiencePreviewResponse> {
    return this.service.previewAudience(id, req);
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

  // ---------- list members (edición de audiencia) ----------
  private readonly _listMembers = signal<ContactResponse[]>([]);
  readonly listMembers = this._listMembers.asReadonly();

  loadListMembers(listId: string): void {
    this._listMembers.set([]);
    this.service.listMembers(listId).subscribe({
      next: m => this._listMembers.set(m ?? []),
      error: () => this._listMembers.set([]),
    });
  }
  addListMember(listId: string, contactId: string): Observable<ContactListResponse> {
    return this.act(this.service.addListMember(listId, contactId), () => {
      this.loadListMembers(listId);
      this.loadLists();
    });
  }
  removeListMember(listId: string, contactId: string): Observable<void> {
    return this.act(this.service.removeListMember(listId, contactId), () => {
      this.loadListMembers(listId);
      this.loadLists();
    });
  }

  // ---------- campaign templates ----------
  loadCampaignTemplates(): void {
    this.service.listCampaignTemplates({ size: 100 }).subscribe({
      next: p => this._campaignTemplates.set(p.items ?? []),
      error: () => this._campaignTemplates.set([]),
    });
  }
  createCampaignTemplate(req: CampaignTemplateRequest): Observable<CampaignTemplateResponse> {
    return this.act(this.service.createCampaignTemplate(req), () => this.loadCampaignTemplates());
  }
  updateCampaignTemplate(id: string, req: CampaignTemplateRequest): Observable<CampaignTemplateResponse> {
    return this.act(this.service.updateCampaignTemplate(id, req), () => this.loadCampaignTemplates());
  }
  deleteCampaignTemplate(id: string): Observable<void> {
    return this.act(this.service.deleteCampaignTemplate(id), () => this.loadCampaignTemplates());
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
