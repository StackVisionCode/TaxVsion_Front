import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, map, of, switchMap, tap } from 'rxjs';
import { NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';
import { SmsService } from './sms.service';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import {
  SendSmsBatchResponse,
  SetSmsConsentRequest,
  SmsConversationSummary,
  SmsMessageSummary,
  SmsOptOutFilter,
  SmsOptOutSummary,
  SmsStatusFilter,
} from './sms.model';

/** Tamaños de página del selector "rows per page". */
export const SMS_PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_SIZE = 25;

/** Marca de origen que viaja en sourceContext (auditoría en los eventos del backend). */
const SOURCE_CONTEXT = 'crm-sms';

/** Resumen de un envío para el toast de la página. */
export interface SmsSendSummary {
  requested: number;
  sent: number;
  suppressed: number;
  failed: number;
}

/** Destinatario de un envío (cliente + teléfono ya E.164 + nombre para el snapshot del log). */
export interface SmsSendRecipient {
  customerId: string;
  to: string;
  name: string;
}

/**
 * Store del módulo SMS (Sms.Api vía /sms). `providedIn: 'root'`.
 *
 * LISTADO = paginación server-side real (`GET /sms/messages?customerId&status&term&from&to&page&size`),
 * mismo patrón que ClientsStore: señales de query → una canalización con `switchMap` que cancela la
 * petición anterior. Las bajas (opt-outs) tienen su propia canalización.
 * Tras un envío o un cambio de consentimiento se re-sincroniza la vista sin recargar el navegador.
 */
@Injectable({ providedIn: 'root' })
export class SmsStore {
  private readonly service = inject(SmsService);
  private readonly directory = inject(CustomerDirectoryStore);
  private readonly realtime = inject(CommunicationRealtimeService);
  private realtimeTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------- Listado de mensajes ----------
  private readonly _customerId = signal<string | null>(null);
  private readonly _status = signal<SmsStatusFilter>('All');
  private readonly _term = signal('');
  private readonly _page = signal(1);
  private readonly _size = signal<number>(DEFAULT_SIZE);
  private readonly _items = signal<SmsMessageSummary[]>([]);
  private readonly _totalCount = signal(0);
  private readonly _totalPages = signal(1);
  private readonly _listLoading = signal(false);
  private readonly _listError = signal<string | null>(null);
  private readonly _listErrorKind = signal<'network' | 'error'>('error');

  readonly customerId = this._customerId.asReadonly();
  readonly status = this._status.asReadonly();
  readonly term = this._term.asReadonly();
  readonly page = this._page.asReadonly();
  readonly size = this._size.asReadonly();
  readonly items = this._items.asReadonly();

  /** Mapa customerId → nombre, resuelto vía el directorio compartido solo para los ids del listado. */
  private readonly _names = signal<Map<string, string>>(new Map());
  readonly contactsById = this._names.asReadonly();
  readonly totalCount = this._totalCount.asReadonly();
  readonly totalPages = this._totalPages.asReadonly();
  readonly listLoading = this._listLoading.asReadonly();
  readonly listError = this._listError.asReadonly();
  readonly listErrorKind = this._listErrorKind.asReadonly();

  // ---------- Conversaciones (agrupado por cliente) ----------
  private readonly _convTerm = signal('');
  private readonly _convPage = signal(1);
  private readonly _convSize = signal<number>(DEFAULT_SIZE);
  private readonly _convItems = signal<SmsConversationSummary[]>([]);
  private readonly _convTotalCount = signal(0);
  private readonly _convTotalPages = signal(1);
  private readonly _convLoading = signal(false);
  private readonly _convError = signal<string | null>(null);
  private readonly _convErrorKind = signal<'network' | 'error'>('error');

  readonly convTerm = this._convTerm.asReadonly();
  readonly convPage = this._convPage.asReadonly();
  readonly convSize = this._convSize.asReadonly();
  readonly convItems = this._convItems.asReadonly();
  readonly convTotalCount = this._convTotalCount.asReadonly();
  readonly convTotalPages = this._convTotalPages.asReadonly();
  readonly convLoading = this._convLoading.asReadonly();
  readonly convError = this._convError.asReadonly();
  readonly convErrorKind = this._convErrorKind.asReadonly();

  // ---------- Hilo de un cliente (drawer de conversación) ----------
  private readonly _threadCustomerId = signal<string | null>(null);
  private readonly _threadItems = signal<SmsMessageSummary[]>([]);
  private readonly _threadLoading = signal(false);
  readonly threadCustomerId = this._threadCustomerId.asReadonly();
  readonly threadItems = this._threadItems.asReadonly();
  readonly threadLoading = this._threadLoading.asReadonly();
  private threadRequestId = 0;

  // ---------- Opt-outs ----------
  private readonly _optStatus = signal<SmsOptOutFilter>('All');
  private readonly _optTerm = signal('');
  private readonly _optPage = signal(1);
  private readonly _optSize = signal<number>(DEFAULT_SIZE);
  private readonly _optItems = signal<SmsOptOutSummary[]>([]);
  private readonly _optTotalCount = signal(0);
  private readonly _optTotalPages = signal(1);
  private readonly _optLoading = signal(false);
  private readonly _optError = signal<string | null>(null);

  readonly optStatus = this._optStatus.asReadonly();
  readonly optTerm = this._optTerm.asReadonly();
  readonly optPage = this._optPage.asReadonly();
  readonly optItems = this._optItems.asReadonly();
  readonly optTotalCount = this._optTotalCount.asReadonly();
  readonly optTotalPages = this._optTotalPages.asReadonly();
  readonly optLoading = this._optLoading.asReadonly();
  readonly optError = this._optError.asReadonly();

  private readonly _sending = signal(false);
  readonly sending = this._sending.asReadonly();

  private readonly load$ = new Subject<void>();
  private readonly loadConv$ = new Subject<void>();
  private readonly loadOpt$ = new Subject<void>();
  private started = false;
  private convStarted = false;
  private optStarted = false;

  constructor() {
    this.load$
      .pipe(
        tap(() => {
          this._listLoading.set(true);
          this._listError.set(null);
        }),
        switchMap(() =>
          this.service
            .listMessages({
              customerId: this._customerId(),
              status: this._status(),
              term: this._term().trim() || undefined,
              page: this._page(),
              size: this._size(),
            })
            .pipe(
              catchError(err => {
                const apiError = toApiError(err);
                this._listErrorKind.set(apiError.code === NETWORK_ERROR_CODE ? 'network' : 'error');
                this._listError.set(apiError.message);
                this._listLoading.set(false);
                return of(null);
              }),
            ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(result => {
        if (!result) return;
        this._items.set(result.items);
        this.resolveNames(result.items);
        this._totalCount.set(result.totalCount);
        this._totalPages.set(result.totalPages);
        this._page.set(result.page);
        this._listLoading.set(false);
      });

    this.loadConv$
      .pipe(
        tap(() => {
          this._convLoading.set(true);
          this._convError.set(null);
        }),
        switchMap(() =>
          this.service
            .listConversations({
              term: this._convTerm().trim() || undefined,
              page: this._convPage(),
              size: this._convSize(),
            })
            .pipe(
              catchError(err => {
                const apiError = toApiError(err);
                this._convErrorKind.set(apiError.code === NETWORK_ERROR_CODE ? 'network' : 'error');
                this._convError.set(apiError.message);
                this._convLoading.set(false);
                return of(null);
              }),
            ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(result => {
        if (!result) return;
        this._convItems.set(result.items);
        this.resolveNames(result.items);
        this._convTotalCount.set(result.totalCount);
        this._convTotalPages.set(result.totalPages);
        this._convPage.set(result.page);
        this._convLoading.set(false);
      });

    this.loadOpt$
      .pipe(
        tap(() => {
          this._optLoading.set(true);
          this._optError.set(null);
        }),
        switchMap(() =>
          this.service
            .listOptOuts({
              status: this._optStatus(),
              term: this._optTerm().trim() || undefined,
              page: this._optPage(),
              size: this._optSize(),
            })
            .pipe(
              catchError(err => {
                this._optError.set(toApiError(err).message);
                this._optLoading.set(false);
                return of(null);
              }),
            ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(result => {
        if (!result) return;
        this._optItems.set(result.items);
        this._optTotalCount.set(result.totalCount);
        this._optTotalPages.set(result.totalPages);
        this._optPage.set(result.page);
        this._optLoading.set(false);
      });

    // Tiempo real (igual que campañas/wallet): Communication relaya `sms.message.updated` cuando cambia el
    // estado de un mensaje (Accepted/Delivered/Failed/Suppressed vía webhook o reconciliación). Se recarga
    // el listado con debounce para no refrescar a mano. `reloadList()` es no-op si la lista aún no arrancó.
    this.realtime.on<unknown>('sms.message.updated').subscribe(() => this.scheduleRealtimeReload());
  }

  /** Coalesce de ráfagas (varios DLR llegan juntos) en una sola recarga ~800ms del historial, las
   *  conversaciones y el hilo abierto (lo que esté activo). */
  private scheduleRealtimeReload(): void {
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer);
    this.realtimeTimer = setTimeout(() => {
      this.reloadList();
      this.reloadConversations();
      this.loadThread();
    }, 800);
  }

  // ---------- Mensajes ----------

  /** Inicializa el listado desde el estado de la URL (idempotente) y dispara la primera carga. */
  initList(query: { customerId?: string | null; status?: SmsStatusFilter; term?: string; page?: number; size?: number }): void {
    // customerId: modo embebido en el perfil (listado fijo a ese cliente).
    if (query.customerId !== undefined) this._customerId.set(query.customerId);
    if (query.status !== undefined) this._status.set(query.status);
    if (query.term !== undefined) this._term.set(query.term);
    if (query.size !== undefined) this._size.set(query.size);
    if (query.page !== undefined) this._page.set(query.page);
    this.started = true;
    this.load$.next();
  }

  setStatus(status: SmsStatusFilter): void {
    this._status.set(status);
    this._page.set(1);
    this.load$.next();
  }

  setTerm(term: string): void {
    this._term.set(term);
    this._page.set(1);
    this.load$.next();
  }

  setSize(size: number): void {
    this._size.set(size);
    this._page.set(1);
    this.load$.next();
  }

  goToPage(page: number): void {
    this._page.set(page);
    this.load$.next();
  }

  /** Resuelve los nombres de los customerIds del listado vía el directorio (cacheado); merge en el mapa. */
  private resolveNames(items: readonly { customerId: string }[]): void {
    const ids = [...new Set(items.map(item => item.customerId).filter(Boolean))];
    if (ids.length === 0) {
      return;
    }
    this.directory.byId(ids).subscribe(resolved => {
      const merged = new Map(this._names());
      resolved.forEach((customer, id) => merged.set(id, customer.displayName));
      this._names.set(merged);
    });
  }

  setCustomer(customerId: string | null): void {
    this._customerId.set(customerId);
    this._page.set(1);
    this.load$.next();
  }

  reloadList(): void {
    if (this.started) this.load$.next();
  }

  getMessage(id: string) {
    return this.service.getMessage(id);
  }

  // ---------- Conversaciones ----------

  /** Inicializa la vista de conversaciones (idempotente) y dispara la primera carga. */
  initConversations(query: { term?: string; page?: number; size?: number } = {}): void {
    if (query.term !== undefined) this._convTerm.set(query.term);
    if (query.size !== undefined) this._convSize.set(query.size);
    if (query.page !== undefined) this._convPage.set(query.page);
    this.convStarted = true;
    this.loadConv$.next();
  }

  setConvTerm(term: string): void {
    this._convTerm.set(term);
    this._convPage.set(1);
    this.loadConv$.next();
  }

  goToConvPage(page: number): void {
    this._convPage.set(page);
    this.loadConv$.next();
  }

  reloadConversations(): void {
    if (this.convStarted) this.loadConv$.next();
  }

  // ---------- Hilo de un cliente ----------

  /** Abre el hilo de un cliente: carga sus mensajes (más recientes primero, hasta 100) y los mantiene
   *  vivos — un evento realtime o un envío lo re-sincroniza mientras el drawer esté abierto. */
  openThread(customerId: string): void {
    this._threadCustomerId.set(customerId);
    this._threadItems.set([]);
    this.loadThread();
  }

  closeThread(): void {
    this._threadCustomerId.set(null);
    this._threadItems.set([]);
  }

  private loadThread(): void {
    const customerId = this._threadCustomerId();
    if (!customerId) return;
    const requestId = ++this.threadRequestId;
    this._threadLoading.set(true);
    this.service.listMessages({ customerId, size: 100 }).subscribe({
      next: p => {
        if (requestId !== this.threadRequestId || this._threadCustomerId() !== customerId) return;
        this._threadItems.set(p.items);
        this._threadLoading.set(false);
      },
      error: () => {
        if (requestId === this.threadRequestId) this._threadLoading.set(false);
      },
    });
  }

  // ---------- Opt-outs ----------

  initOptOuts(): void {
    this.optStarted = true;
    this.loadOpt$.next();
  }

  setOptStatus(status: SmsOptOutFilter): void {
    this._optStatus.set(status);
    this._optPage.set(1);
    this.loadOpt$.next();
  }

  setOptTerm(term: string): void {
    this._optTerm.set(term);
    this._optPage.set(1);
    this.loadOpt$.next();
  }

  goToOptPage(page: number): void {
    this._optPage.set(page);
    this.loadOpt$.next();
  }

  reloadOptOuts(): void {
    if (this.optStarted) this.loadOpt$.next();
  }

  /** Gestión manual del consentimiento (admin, `sms.manage`). Re-sincroniza la lista. */
  setConsent(req: SetSmsConsentRequest): Observable<SmsOptOutSummary> {
    return this.service.setConsent(req).pipe(
      tap(() => {
        this.reloadOptOuts();
      }),
    );
  }


  // ---------- Envío (compose) ----------

  /**
   * Un solo POST /sms/messages con un item por destinatario (endpoint de lote nativo). Los opted-out
   * los suprime el backend (no se cobran). Tras responder, re-sincroniza el listado y las stats.
   */
  send(recipients: SmsSendRecipient[], body: string): Observable<SmsSendSummary> {
    const text = body.trim();
    this._sending.set(true);
    return this.service
      .sendMessages({
        messages: recipients.map(r => ({
          customerId: r.customerId,
          to: r.to,
          message: text,
          recipientName: r.name,
          media: null,
          // UUID por click: sin él, el backend deduplica por (customer, to, body) y un reenvío no saldría.
          idempotencyKey: crypto.randomUUID(),
          sourceContext: SOURCE_CONTEXT,
        })),
      })
      .pipe(
        tap({
          next: () => {
            this._sending.set(false);
            this.reloadList();
          },
          error: () => this._sending.set(false),
        }),
        map(response => this.summarize(recipients.length, response)),
      );
  }

  private summarize(requested: number, response: SendSmsBatchResponse): SmsSendSummary {
    let sent = 0;
    let suppressed = 0;
    let failed = 0;
    for (const result of response.results) {
      switch (result.status) {
        case 'Suppressed':
          suppressed++;
          break;
        case 'Failed':
        case 'Undeliverable':
          failed++;
          break;
        default:
          sent++;
      }
    }
    return { requested, sent, suppressed, failed };
  }
}
