import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { AccessStore } from '@core/access/access.store';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { CallsService } from '@core/communication/calls.service';
import { CustomerCallsResponse } from '@core/communication/call.model';
import { ClientWorkService } from './client-work.service';
import { ClientCommunicationService } from './client-communication.service';
import { ClientNotesService } from './client-notes.service';
import { ClientRequestsService } from './client-requests.service';
import { ClientPortalService } from './client-portal.service';
import { ClientSummaryService, SummaryInvoice, SummaryMeeting, SummarySignatureRequest, SummarySmsMessage } from './client-summary.service';
import { ClientProfileTabId, TAB_ACCESS } from './client-tab-access';
import { ApiTaskPriority, ApiTaskStatus, WorkTaskItem, toWorkTaskItem } from './client-work.model';
import { ClientEmailThreadRow, toClientEmailThreadRow } from './client-communication.model';
import { NoteResponse } from './client-notes.model';
import { ClientRequestItem, toClientRequestItem } from './client-requests.model';
import { PortalAccess, derivePortalAccess } from './client-portal.model';

/** Estados abiertos: todo lo que no está cerrado (Completed) ni cancelado (Cancelled). */
const OPEN_STATUSES: ApiTaskStatus[] = ['NotStarted', 'InProgress', 'WaitingOnClient'];

/** El Overview no muestra asignados, así que no resuelve nombres: mapa vacío para `toWorkTaskItem`. */
const NO_NAMES = new Map<string, string>();

/** Orden de urgencia para "Needs attention" (vencidas primero, luego por prioridad). */
const PRIORITY_RANK: Record<ApiTaskPriority, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

/** Cuántas filas se muestran en cada tarjeta de resumen. */
const NEEDS_ATTENTION_MAX = 5;
const RECENT_ACTIVITY_MAX = 4;
const RECENT_ROWS = 3;

/** Firmas en curso (enviadas o por enviar) vs. las que necesitan atención. */
const SIGNATURE_PENDING = new Set(['Ready', 'Scheduled', 'InProgress']);
const SIGNATURE_ATTENTION = new Set(['Rejected', 'Expired', 'Canceled']);
/** Facturas que todavía se pueden cobrar. */
const INVOICE_OPEN = new Set(['Issued', 'Sent', 'PartiallyPaid']);

export interface InvoiceSummaryView {
  currency: string;
  count: number;
  collectedCents: number;
  outstandingCents: number;
  paid: number;
  open: number;
  draft: number;
  /** % cobrado sobre lo facturado (sin borradores ni anuladas). */
  collectedPercent: number;
  recent: SummaryInvoice[];
}

export interface SignatureSummaryView {
  total: number;
  completed: number;
  pending: number;
  attention: number;
  draft: number;
  recent: SummarySignatureRequest[];
}

/** Secciones del Overview que dependen de otro servicio (y de su permiso). */
export type OverviewSection =
  | 'work'
  | 'documents'
  | 'communication'
  | 'invoices'
  | 'signatures'
  | 'notes'
  | 'sms'
  | 'meetings'
  | 'calls'
  | 'requests'
  | 'portal';

/**
 * Store del "360 de un vistazo" del tab Overview. Agrega los listados REALES por cliente que ya
 * existen en el backend — tareas, documentos, hilos de email, facturas, firmas, notas, SMS, meetings,
 * llamadas, solicitudes y acceso al portal — para las tarjetas del Overview.
 *
 * Cada fuente se pide SOLO si el usuario puede abrir la pestaña correspondiente (mismo `TAB_ACCESS`
 * que el menú del perfil), y cada lectura tolera un 403/fallo (`catchError` → vacío): una fuente
 * caída deja su tarjeta vacía en vez de romper la vista. `available()` dice qué tarjetas mostrar.
 * `providedIn: 'root'` con estado por cliente: `load(id)` limpia si cambió el cliente. Solo lectura.
 *
 * Fuera a propósito: Reminders (el servicio no filtra por cliente), Bank y Mileage (sin backend).
 */
@Injectable({ providedIn: 'root' })
export class ClientOverviewStore {
  private readonly work = inject(ClientWorkService);
  private readonly cloud = inject(CloudStorageUploadService);
  private readonly comm = inject(ClientCommunicationService);
  private readonly notesApi = inject(ClientNotesService);
  private readonly requestsApi = inject(ClientRequestsService);
  private readonly portalApi = inject(ClientPortalService);
  private readonly summaryApi = inject(ClientSummaryService);
  private readonly callsApi = inject(CallsService);
  private readonly access = inject(AccessStore);

  private clientId = '';

  private readonly _openTasks = signal<WorkTaskItem[]>([]);
  private readonly _docsCount = signal(0);
  private readonly _threads = signal<ClientEmailThreadRow[]>([]);
  private readonly _invoices = signal<SummaryInvoice[]>([]);
  private readonly _signatures = signal<SummarySignatureRequest[]>([]);
  private readonly _signatureTotal = signal(0);
  private readonly _notes = signal<NoteResponse[]>([]);
  private readonly _notesTotal = signal(0);
  private readonly _sms = signal<SummarySmsMessage[]>([]);
  private readonly _smsTotal = signal(0);
  private readonly _meetings = signal<SummaryMeeting[]>([]);
  private readonly _meetingsTotal = signal(0);
  private readonly _calls = signal<CustomerCallsResponse | null>(null);
  private readonly _requests = signal<ClientRequestItem[]>([]);
  private readonly _portal = signal<PortalAccess | null>(null);
  private readonly _available = signal<ReadonlySet<OverviewSection>>(new Set());
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);

  readonly loading = this._loading.asReadonly();
  /** true tras la primera carga de este cliente (para no pintar "vacío" mientras llega). */
  readonly loaded = this._loaded.asReadonly();
  readonly available = this._available.asReadonly();

  readonly openTaskCount = computed(() => this._openTasks().length);
  /** Tareas abiertas ya vencidas (para el medidor de carga del Overview). */
  readonly overdueCount = computed(() => this._openTasks().filter(task => task.overdue).length);
  readonly docsCount = this._docsCount.asReadonly();
  readonly threadCount = computed(() => this._threads().length);

  /** Tareas abiertas priorizadas: vencidas primero, luego por prioridad, luego por vencimiento más cercano. */
  readonly needsAttention = computed<WorkTaskItem[]>(() =>
    [...this._openTasks()]
      .sort((a, b) => {
        if (a.overdue !== b.overdue) {
          return a.overdue ? -1 : 1;
        }
        const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (byPriority !== 0) {
          return byPriority;
        }
        // Las que tienen fecha van antes que las que no; entre ellas, la más próxima primero.
        return (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31');
      })
      .slice(0, NEEDS_ATTENTION_MAX),
  );

  /** Hilos de email más recientes (ya vienen ordenados desc por `load`). */
  readonly recentActivity = computed<ClientEmailThreadRow[]>(() => this._threads().slice(0, RECENT_ACTIVITY_MAX));

  /**
   * Resumen de facturación. Los montos se suman en la moneda más usada del cliente (las facturas en
   * otra moneda no se mezclan en el total, pero sí cuentan en los estados).
   */
  readonly invoiceSummary = computed<InvoiceSummaryView>(() => {
    const all = this._invoices();
    const byCurrency = new Map<string, number>();
    all.forEach(inv => byCurrency.set(inv.currency, (byCurrency.get(inv.currency) ?? 0) + 1));
    const currency = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD';
    const sameCurrency = all.filter(inv => inv.currency === currency && inv.status !== 'Voided' && inv.status !== 'Draft');
    const collectedCents = sameCurrency.reduce((sum, inv) => sum + inv.amountPaidCents, 0);
    const outstandingCents = sameCurrency
      .filter(inv => INVOICE_OPEN.has(inv.status))
      .reduce((sum, inv) => sum + inv.amountDueCents, 0);
    const billed = collectedCents + outstandingCents;
    return {
      currency,
      count: all.length,
      collectedCents,
      outstandingCents,
      paid: all.filter(inv => inv.status === 'Paid').length,
      open: all.filter(inv => INVOICE_OPEN.has(inv.status)).length,
      draft: all.filter(inv => inv.status === 'Draft').length,
      collectedPercent: billed > 0 ? Math.round((collectedCents / billed) * 100) : 0,
      recent: [...all].sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc)).slice(0, RECENT_ROWS),
    };
  });

  readonly signatureSummary = computed<SignatureSummaryView>(() => {
    const all = this._signatures();
    return {
      total: this._signatureTotal(),
      completed: all.filter(s => s.status === 'Completed').length,
      pending: all.filter(s => SIGNATURE_PENDING.has(s.status)).length,
      attention: all.filter(s => SIGNATURE_ATTENTION.has(s.status)).length,
      draft: all.filter(s => s.status === 'Draft').length,
      recent: [...all].sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc)).slice(0, RECENT_ROWS),
    };
  });

  readonly recentNotes = computed(() => this._notes().slice(0, RECENT_ROWS));
  readonly notesTotal = this._notesTotal.asReadonly();

  readonly recentSms = computed(() => this._sms().slice(0, RECENT_ROWS));
  readonly smsTotal = this._smsTotal.asReadonly();

  readonly upcomingMeetings = this._meetings.asReadonly();
  readonly meetingsTotal = this._meetingsTotal.asReadonly();
  /** El próximo meeting (o el que está en vivo). */
  readonly nextMeeting = computed(() => this._meetings()[0] ?? null);

  readonly calls = this._calls.asReadonly();

  readonly openRequests = computed(() =>
    this._requests().filter(r => r.status === 'Pending' || r.status === 'Submitted'),
  );
  readonly requestsToReview = computed(() => this._requests().filter(r => r.status === 'Submitted').length);
  readonly portal = this._portal.asReadonly();

  /** `email` es el respaldo para el estado del portal cuando no hay invitación ni usuario. */
  load(clientId: string, email = ''): void {
    if (clientId !== this.clientId) {
      this.clientId = clientId;
      this.clear();
    }
    if (!this.clientId) {
      return;
    }
    const id = this.clientId;
    const available = new Set<OverviewSection>();
    /** Pide `source$` solo si el usuario puede abrir esa pestaña; si no, devuelve el vacío. */
    const gated = <T>(section: OverviewSection, tab: ClientProfileTabId, source$: () => Observable<T>, empty: T) => {
      const requirement = TAB_ACCESS[tab];
      if (requirement && !this.access.canUse(requirement)) {
        return of(empty);
      }
      available.add(section);
      return source$().pipe(catchError(() => of(empty)));
    };

    this._loading.set(true);
    forkJoin({
      tasks: gated('work', 'work', () => this.work.byCustomer(id), null),
      docs: gated('documents', 'documents', () => this.cloud.listFiles(0, 100, 'Customer', id), []),
      threads: gated('communication', 'communication', () => this.comm.listThreads(id), null),
      invoices: gated('invoices', 'invoices', () => this.summaryApi.invoices(id), [] as SummaryInvoice[]),
      signatures: gated('signatures', 'signatures', () => this.summaryApi.signatures(id), null),
      notes: gated('notes', 'notes', () => this.notesApi.listByClient(id, 1, RECENT_ROWS), null),
      sms: gated('sms', 'sms', () => this.summaryApi.sms(id), null),
      meetings: gated('meetings', 'meetings', () => this.summaryApi.upcomingMeetings(id), null),
      calls: gated('calls', 'calls', () => this.callsApi.getCustomerCalls(id), null),
      // Las solicitudes viven dentro de Work (mismo permiso que las tareas).
      requests: gated('requests', 'work', () => this.requestsApi.byCustomer(id), []),
      portal: gated(
        'portal',
        'portal',
        () =>
          forkJoin({
            invitations: this.portalApi.listInvitations(id),
            users: this.portalApi.listUsers(id),
          }).pipe(map(({ invitations, users }) => derivePortalAccess(invitations.items, users.items, email))),
        null,
      ),
    }).subscribe(result => {
      if (id !== this.clientId) {
        return; // llegó tarde, de un cliente anterior
      }
      const open = (result.tasks?.items ?? [])
        .filter(task => OPEN_STATUSES.includes(task.status))
        .map(task => toWorkTaskItem(task, NO_NAMES));
      this._openTasks.set(open);
      this._docsCount.set(result.docs?.length ?? 0);
      this._threads.set(
        (result.threads?.items ?? []).map(toClientEmailThreadRow).sort((a, b) => b.lastMessageTime - a.lastMessageTime),
      );
      this._invoices.set(result.invoices ?? []);
      this._signatures.set(result.signatures?.items ?? []);
      this._signatureTotal.set(result.signatures?.totalCount ?? 0);
      this._notes.set(result.notes?.items ?? []);
      this._notesTotal.set(result.notes?.totalCount ?? 0);
      this._sms.set([...(result.sms?.items ?? [])].sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc)));
      this._smsTotal.set(result.sms?.totalCount ?? 0);
      this._meetings.set(result.meetings?.items ?? []);
      this._meetingsTotal.set(result.meetings?.totalCount ?? 0);
      this._calls.set(result.calls);
      this._requests.set((result.requests ?? []).map(toClientRequestItem));
      this._portal.set(result.portal);
      this._available.set(available);
      this._loading.set(false);
      this._loaded.set(true);
    });
  }

  private clear(): void {
    this._openTasks.set([]);
    this._docsCount.set(0);
    this._threads.set([]);
    this._invoices.set([]);
    this._signatures.set([]);
    this._signatureTotal.set(0);
    this._notes.set([]);
    this._notesTotal.set(0);
    this._sms.set([]);
    this._smsTotal.set(0);
    this._meetings.set([]);
    this._meetingsTotal.set(0);
    this._calls.set(null);
    this._requests.set([]);
    this._portal.set(null);
    this._available.set(new Set());
    this._loaded.set(false);
  }
}
