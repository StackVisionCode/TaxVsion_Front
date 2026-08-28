import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { ClientItem } from '../ui/client-table/client-table.component';
import { ClientsService } from './clients.service';
import {
  AddAddressRequest,
  AddContactPointRequest,
  AddRelationRequest,
  AddressResponse,
  ContactPointResponse,
  CreateCustomerRequest,
  Customer,
  CustomerDetailResponse,
  CustomerStatus,
  CustomerStatusAction,
  FiscalSubjectKind,
  RelationResponse,
  RevealedTaxIdentifierResponse,
  UpdateCustomerRequest,
  customerToClientItem,
  summaryToClientItem,
} from './clients.model';

/**
 * El backend no filtra por tipo (individual/company) en GET /customers, así que se
 * trae un lote grande de una vez y el filtro de tipo + estado + la paginación de UI
 * quedan del lado del cliente, igual que antes con la seed local. Siempre se pide
 * `NotArchived` (Active + Inactive): "delete" en esta UI archiva, no borra, así que
 * un cliente archivado simplemente deja de aparecer acá.
 */
const FETCH_SIZE = 200;

export interface ClientSaveOptions {
  /** SSN/ITIN o EIN a persistir vía PUT fiscal-profile. Vacío = no tocar el perfil fiscal. Best-effort (requiere TenantAdmin). */
  taxIdentifier: string;
  subjectKind: FiscalSubjectKind;
  /** Estado deseado (toggle "Active client" del formulario). */
  isActive: boolean;
}

/**
 * Store de clientes (Customer.Api vía /customers). Compartido por el directorio y
 * el perfil de cliente — providedIn: 'root' para que ambas rutas vean la misma lista.
 */
@Injectable({ providedIn: 'root' })
export class ClientsStore {
  private readonly service = inject(ClientsService);

  private readonly _clients = signal<ClientItem[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _search = signal('');

  readonly clients = this._clients.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly search = this._search.asReadonly();

  setSearch(term: string): void {
    this._search.set(term);
    this.refresh();
  }

  refresh(): void {
    this._loading.set(true);
    this._error.set(null);
    this.service
      .search({
        term: this._search().trim() || undefined,
        status: 'NotArchived',
        size: FETCH_SIZE,
      })
      .subscribe({
        next: result => {
          this._clients.set(result.items.map(summaryToClientItem));
          this._loading.set(false);
        },
        error: err => {
          this._error.set(toApiError(err).message);
          this._loading.set(false);
        },
      });
  }

  getById(id: string): Observable<CustomerDetailResponse> {
    return this.service.getById(id);
  }

  // ---------- Sub-recursos del detalle (direcciones / contactos / relaciones / fiscal) ----------

  revealTaxIdentifier(id: string): Observable<RevealedTaxIdentifierResponse> {
    return this.service.revealTaxIdentifier(id);
  }

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

  createClient(req: CreateCustomerRequest, options: ClientSaveOptions): Observable<ClientItem> {
    return this.service.create(req).pipe(
      switchMap(customer => this.finishSave(customer, options)),
      tap(item => this._clients.update(list => [item, ...list])),
    );
  }

  updateClient(id: string, req: UpdateCustomerRequest, options: ClientSaveOptions): Observable<ClientItem> {
    return this.service.update(id, req).pipe(
      switchMap(customer => this.finishSave(customer, options)),
      tap(item => this._clients.update(list => list.map(c => (c.id === item.id ? item : c)))),
    );
  }

  /** archive/reactivate/activate/deactivate. `archive` retira al cliente de la lista (equivalente a "delete" en esta UI). */
  changeStatus(id: string, action: CustomerStatusAction): Observable<void> {
    return this.service.changeStatus(id, action).pipe(
      tap(() => {
        if (action === 'archive') {
          this._clients.update(list => list.filter(c => c.id !== id));
          return;
        }
        const isActive = action === 'activate' || action === 'reactivate';
        this._clients.update(list => list.map(c => (c.id === id ? { ...c, isActive } : c)));
      }),
    );
  }

  /** Tras crear/actualizar: aplica el toggle Active/Inactive del form y, si hay SSN/EIN, el perfil fiscal. Ambos best-effort. */
  private finishSave(customer: Customer, options: ClientSaveOptions): Observable<ClientItem> {
    const item = customerToClientItem(customer);
    const statusAction = this.statusActionFor(customer.status, options.isActive);
    const statusCall = statusAction
      ? this.service.changeStatus(customer.id, statusAction).pipe(
          catchError(err => {
            console.warn('No se pudo cambiar el estado del cliente:', toApiError(err).message);
            return of(undefined);
          }),
        )
      : of(undefined);

    const taxIdentifier = options.taxIdentifier.trim();
    const fiscalCall = taxIdentifier
      ? this.service
          .setFiscalProfile(customer.id, {
            subjectKind: options.subjectKind,
            taxIdentifier,
            isReturningCustomer: false,
          })
          .pipe(
            catchError(err => {
              // PUT fiscal-profile requiere rol TenantAdmin — un TenantEmployee recibe 403 acá, sin bloquear el resto del guardado.
              console.warn('No se pudo guardar el perfil fiscal (SSN/EIN):', toApiError(err).message);
              return of(undefined);
            }),
          )
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
