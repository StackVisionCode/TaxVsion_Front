import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, debounceTime, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';
import { SmsService } from './sms.service';
import {
  SendSmsBatchResponse,
  SetSmsConsentRequest,
  SmsContact,
  SmsMessageSummary,
  SmsOptOutFilter,
  SmsOptOutSummary,
  SmsStats,
  SmsStatusFilter,
  toSmsContact,
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
 * petición anterior. Las bajas (opt-outs) tienen su propia canalización. Las stats se piden aparte.
 * Tras un envío o un cambio de consentimiento se re-sincroniza la vista sin recargar el navegador.
 */
@Injectable({ providedIn: 'root' })
export class SmsStore {
  private readonly service = inject(SmsService);

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
  readonly totalCount = this._totalCount.asReadonly();
  readonly totalPages = this._totalPages.asReadonly();
  readonly listLoading = this._listLoading.asReadonly();
  readonly listError = this._listError.asReadonly();
  readonly listErrorKind = this._listErrorKind.asReadonly();

  // ---------- Stats ----------
  private readonly _stats = signal<SmsStats | null>(null);
  readonly stats = this._stats.asReadonly();
  /** Tasa de entrega sobre lo enviado (excluye suppressed/pending). 0 si no hay envíos. */
  readonly deliveryRate = computed<number>(() => {
    const s = this._stats();
    if (!s) return 0;
    const sent = s.accepted + s.delivered + s.failed + s.undeliverable;
    return sent === 0 ? 0 : Math.round((s.delivered / sent) * 100);
  });

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

  // ---------- Clientes (picker del compose) ----------
  private readonly _contacts = signal<SmsContact[]>([]);
  private readonly _contactsLoaded = signal(false);
  readonly contacts = this._contacts.asReadonly();
  /** Solo clientes texteables (teléfono E.164 válido en la ficha). */
  readonly textableContacts = computed<SmsContact[]>(() =>
    this._contacts().filter(contact => contact.phoneE164 !== null),
  );

  // ---------- Picker del compose (búsqueda server-side, alcanza TODOS los clientes) ----------
  private readonly _pickerResults = signal<SmsContact[]>([]);
  readonly pickerResults = this._pickerResults.asReadonly();
  private readonly pickerSearch$ = new Subject<string>();

  private readonly _sending = signal(false);
  readonly sending = this._sending.asReadonly();

  private readonly load$ = new Subject<void>();
  private readonly loadOpt$ = new Subject<void>();
  private started = false;
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
        this._totalCount.set(result.totalCount);
        this._totalPages.set(result.totalPages);
        this._page.set(result.page);
        this._listLoading.set(false);
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

    // Picker del compose: búsqueda server-side (debounce + switchMap cancela la anterior). Solo
    // clientes texteables (con teléfono E.164 válido). Alcanza TODOS los clientes, no solo los 200 de
    // la primera página.
    this.pickerSearch$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap(term =>
          this.service.searchCustomers(term).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(result => {
        if (!result) return;
        this._pickerResults.set(
          result.items.map(toSmsContact).filter(c => c.phoneE164 !== null),
        );
      });
  }

  // ---------- Mensajes ----------

  /** Inicializa el listado desde el estado de la URL (idempotente) y dispara la primera carga. */
  initList(query: { status?: SmsStatusFilter; term?: string; page?: number; size?: number }): void {
    if (query.status !== undefined) this._status.set(query.status);
    if (query.term !== undefined) this._term.set(query.term);
    if (query.size !== undefined) this._size.set(query.size);
    if (query.page !== undefined) this._page.set(query.page);
    this.started = true;
    this.load$.next();
    this.loadStats();
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

  setCustomer(customerId: string | null): void {
    this._customerId.set(customerId);
    this._page.set(1);
    this.load$.next();
  }

  reloadList(): void {
    if (this.started) this.load$.next();
  }

  loadStats(from?: string | null, to?: string | null): void {
    this.service
      .getStats(from, to)
      .pipe(catchError(() => of(null)))
      .subscribe(stats => {
        if (stats) this._stats.set(stats);
      });
  }

  getMessage(id: string) {
    return this.service.getMessage(id);
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

  /** Gestión manual del consentimiento (admin, `sms.manage`). Re-sincroniza la lista y las stats. */
  setConsent(req: SetSmsConsentRequest): Observable<SmsOptOutSummary> {
    return this.service.setConsent(req).pipe(
      tap(() => {
        this.reloadOptOuts();
        this.loadStats();
      }),
    );
  }

  // ---------- Clientes (compose) ----------

  /** Dispara la búsqueda server-side del picker (el pipeline la debouncea y cancela la anterior). */
  searchPicker(term: string): void {
    this.pickerSearch$.next(term);
  }

  loadContacts(): void {
    if (this._contactsLoaded()) return;
    this.service
      .listCustomers()
      .pipe(catchError(() => of(null)))
      .subscribe(result => {
        if (!result) return;
        const contacts = result.items.map(toSmsContact).sort((a, b) => a.name.localeCompare(b.name));
        this._contacts.set(contacts);
        this._contactsLoaded.set(true);
      });
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
            this.loadStats();
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
