import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, forkJoin, map, of, switchMap, tap } from 'rxjs';
import { NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';
import { ClientItem } from '../ui/client-table/client-table.component';
import { ClientsService } from './clients.service';
import {
  AddAddressRequest,
  AddContactPointRequest,
  AddRelationRequest,
  AddressResponse,
  BulkStatusActionResponse,
  ContactPointResponse,
  CreateCustomerRequest,
  Customer,
  CustomerDetailResponse,
  CustomerExistsResponse,
  CustomerStatus,
  CustomerStatusAction,
  CustomerStatusFilter,
  CustomerSummary,
  FiscalSubjectKind,
  RelationResponse,
  RevealedTaxIdentifierResponse,
  SetCustomerFiscalProfileRequest,
  UpdateCustomerRequest,
  customerToClientItem,
} from './clients.model';

/** Tamaños de página ofrecidos en el selector "rows per page". */
export const LIST_PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_SIZE = 25;
const DEFAULT_STATUS: CustomerStatusFilter = 'NotArchived';

export interface ClientSaveOptions {
  /** SSN/ITIN o EIN a persistir vía PUT fiscal-profile. Vacío = no tocar el perfil fiscal. Best-effort (requiere TenantAdmin). */
  taxIdentifier: string;
  subjectKind: FiscalSubjectKind;
  /** Estado deseado (toggle "Active client" del formulario). */
  isActive: boolean;
}

/**
 * Store de clientes (Customer.Api vía /customers), compartido por directorio y perfil
 * (`providedIn: 'root'`).
 *
 * El LISTADO es paginación server-side real: `GET /customers?term&status&page&size`.
 * Las señales de query (`term/status/page/size`) alimentan una única canalización con
 * `switchMap`, que cancela la petición anterior cuando el usuario cambia algo (evita
 * respuestas fuera de orden). Tras una mutación (crear/editar/estado/bulk) se re-pide la
 * página actual en background — así la UI queda consistente SIN recargar el navegador.
 */
@Injectable({ providedIn: 'root' })
export class ClientsStore {
  private readonly service = inject(ClientsService);

  // ---------- Estado del listado ----------
  private readonly _term = signal('');
  private readonly _status = signal<CustomerStatusFilter>(DEFAULT_STATUS);
  private readonly _page = signal(1);
  private readonly _size = signal<number>(DEFAULT_SIZE);
  private readonly _items = signal<CustomerSummary[]>([]);
  private readonly _totalCount = signal(0);
  private readonly _totalPages = signal(1);
  private readonly _listLoading = signal(false);
  private readonly _listError = signal<string | null>(null);
  /** Tipo del fallo del listado, para elegir el estado (sin red · genérico). */
  private readonly _listErrorKind = signal<'network' | 'error'>('error');

  readonly term = this._term.asReadonly();
  readonly status = this._status.asReadonly();
  readonly page = this._page.asReadonly();
  readonly size = this._size.asReadonly();
  readonly items = this._items.asReadonly();
  readonly totalCount = this._totalCount.asReadonly();
  readonly totalPages = this._totalPages.asReadonly();
  readonly listLoading = this._listLoading.asReadonly();
  readonly listError = this._listError.asReadonly();
  readonly listErrorKind = this._listErrorKind.asReadonly();

  // ---------- Conteos por estado (stat cards) ----------
  // Obtenidos con consultas de conteo dedicadas (size:1 → totalCount real por estado).
  // No hay agregado por tipo (Individual/Business) en el backend, así que NO se exponen.
  private readonly _counts = signal<{ active: number; inactive: number; archived: number }>({
    active: 0,
    inactive: 0,
    archived: 0,
  });
  readonly counts: Signal<{ active: number; inactive: number; archived: number; total: number }> = computed(() => {
    const c = this._counts();
    return { ...c, total: c.active + c.inactive + c.archived };
  });

  private readonly load$ = new Subject<void>();
  private started = false;

  constructor() {
    this.load$
      .pipe(
        tap(() => {
          this._listLoading.set(true);
          this._listError.set(null);
        }),
        switchMap(() =>
          this.service
            .search({
              term: this._term().trim() || undefined,
              status: this._status(),
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
        if (!result) {
          return;
        }
        this._items.set(result.items);
        this._totalCount.set(result.totalCount);
        this._totalPages.set(result.totalPages);
        this._page.set(result.page);
        this._listLoading.set(false);
      });
  }

  /** Inicializa el listado desde el estado de la URL (idempotente); dispara la primera carga una sola vez. */
  initList(query: { term?: string; status?: CustomerStatusFilter; page?: number; size?: number }): void {
    if (query.term !== undefined) this._term.set(query.term);
    if (query.status !== undefined) this._status.set(query.status);
    if (query.size !== undefined) this._size.set(query.size);
    if (query.page !== undefined) this._page.set(query.page);
    this.started = true;
    this.load$.next();
    this.loadCounts();
  }

  /** Refresca los conteos por estado (3 consultas de conteo en paralelo, best-effort). */
  loadCounts(): void {
    forkJoin({
      active: this.service.search({ status: 'Active', page: 1, size: 1 }),
      inactive: this.service.search({ status: 'Inactive', page: 1, size: 1 }),
      archived: this.service.search({ status: 'Archived', page: 1, size: 1 }),
    })
      .pipe(catchError(() => of(null)))
      .subscribe(result => {
        if (result) {
          this._counts.set({
            active: result.active.totalCount,
            inactive: result.inactive.totalCount,
            archived: result.archived.totalCount,
          });
        }
      });
  }

  /** Tras una mutación de estado: re-sincroniza la página visible y los conteos. */
  private afterMutation(): void {
    this.reloadList();
    this.loadCounts();
  }

  setTerm(term: string): void {
    this._term.set(term);
    this._page.set(1);
    this.load$.next();
  }

  setStatus(status: CustomerStatusFilter): void {
    this._status.set(status);
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

  /** Re-pide la página actual (sincronización en background tras una mutación). */
  reloadList(): void {
    if (this.started) {
      this.load$.next();
    }
  }

  // ---------- Detalle ----------

  getById(id: string): Observable<CustomerDetailResponse> {
    return this.service.getById(id);
  }

  /** Preflight de duplicados por email / tax id (GET /customers/check-exists). */
  checkExists(email?: string, taxIdentifier?: string): Observable<CustomerExistsResponse> {
    return this.service.checkExists(email, taxIdentifier);
  }

  revealTaxIdentifier(id: string): Observable<RevealedTaxIdentifierResponse> {
    return this.service.revealTaxIdentifier(id);
  }

  /** PUT /customers/{id}/fiscal-profile — crear/editar el perfil fiscal (SSN/EIN). Requiere rol TenantAdmin. */
  setFiscalProfile(id: string, req: SetCustomerFiscalProfileRequest): Observable<unknown> {
    return this.service.setFiscalProfile(id, req);
  }

  // ---------- Sub-recursos del detalle ----------

  addAddress(customerId: string, req: AddAddressRequest): Observable<AddressResponse> {
    return this.service.addAddress(customerId, req);
  }

  updateAddress(customerId: string, addressId: string, req: AddAddressRequest): Observable<AddressResponse> {
    return this.service.updateAddress(customerId, addressId, req);
  }

  deleteAddress(customerId: string, addressId: string): Observable<void> {
    return this.service.deleteAddress(customerId, addressId);
  }

  addContactPoint(customerId: string, req: AddContactPointRequest): Observable<ContactPointResponse> {
    return this.service.addContactPoint(customerId, req);
  }

  updateContactPoint(customerId: string, contactPointId: string, req: AddContactPointRequest): Observable<ContactPointResponse> {
    return this.service.updateContactPoint(customerId, contactPointId, req);
  }

  deleteContactPoint(customerId: string, contactPointId: string): Observable<void> {
    return this.service.deleteContactPoint(customerId, contactPointId);
  }

  addRelation(customerId: string, req: AddRelationRequest): Observable<RelationResponse> {
    return this.service.addRelation(customerId, req);
  }

  updateRelation(customerId: string, relationId: string, req: AddRelationRequest): Observable<RelationResponse> {
    return this.service.updateRelation(customerId, relationId, req);
  }

  deleteRelation(customerId: string, relationId: string): Observable<void> {
    return this.service.deleteRelation(customerId, relationId);
  }

  // ---------- Mutaciones que afectan al listado ----------

  createClient(req: CreateCustomerRequest, options: ClientSaveOptions): Observable<ClientItem> {
    return this.service.create(req).pipe(
      switchMap(customer => this.finishSave(customer, options)),
      tap(() => this.afterMutation()),
    );
  }

  updateClient(id: string, req: UpdateCustomerRequest, options: ClientSaveOptions): Observable<ClientItem> {
    return this.service.update(id, req).pipe(
      switchMap(customer => this.finishSave(customer, options)),
      tap(() => this.afterMutation()),
    );
  }

  /** archive/reactivate/activate/deactivate. Re-sincroniza la página y los conteos tras el 204. */
  changeStatus(id: string, action: CustomerStatusAction): Observable<void> {
    return this.service.changeStatus(id, action).pipe(tap(() => this.afterMutation()));
  }

  /** Acción de estado masiva. Devuelve el desglose (con fallos parciales) y re-sincroniza. */
  bulkStatus(action: CustomerStatusAction, customerIds: string[], reason?: string | null): Observable<BulkStatusActionResponse> {
    return this.service.bulkStatus(action, customerIds, reason).pipe(tap(() => this.afterMutation()));
  }

  /** Tras crear/actualizar: aplica el toggle Active/Inactive del form y, si hay SSN/EIN, el perfil fiscal. Ambos best-effort. */
  private finishSave(customer: Customer, options: ClientSaveOptions): Observable<ClientItem> {
    const item = customerToClientItem(customer);
    const statusAction = this.statusActionFor(customer.status, options.isActive);
    const statusCall = statusAction
      ? this.service.changeStatus(customer.id, statusAction).pipe(catchError(() => of(undefined)))
      : of(undefined);

    const taxIdentifier = options.taxIdentifier.trim();
    const fiscalCall = taxIdentifier
      ? this.service
          .setFiscalProfile(customer.id, {
            subjectKind: options.subjectKind,
            taxIdentifier,
            isReturningCustomer: false,
          })
          // PUT fiscal-profile requiere rol TenantAdmin — un TenantEmployee recibe 403 sin bloquear el guardado.
          .pipe(catchError(() => of(undefined)))
      : of(undefined);

    return statusCall.pipe(
      switchMap(() => fiscalCall),
      map(() => ({ ...item, isActive: options.isActive })),
    );
  }

  private statusActionFor(current: CustomerStatus, desiredActive: boolean): CustomerStatusAction | null {
    if (current === 'Archived') {
      return null;
    }
    const currentlyActive = current === 'Active';
    if (currentlyActive === desiredActive) {
      return null;
    }
    return desiredActive ? 'activate' : 'deactivate';
  }
}
