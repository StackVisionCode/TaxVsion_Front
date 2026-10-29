import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { readOnlyRequestContext } from '@core/http/read-only-request';
import {
  AddAddressRequest,
  AddContactPointRequest,
  AddRelationRequest,
  AddressResponse,
  BulkAssignRequest,
  BulkAssignResponse,
  BulkStatusActionRequest,
  BulkStatusActionResponse,
  BusinessActivityOption,
  ContactPointResponse,
  CreateCustomerRequest,
  Customer,
  CustomerDetailResponse,
  CustomerExistsResponse,
  CustomerKind,
  CustomerListSort,
  CustomerStatusAction,
  CustomerStatusFilter,
  CustomerSummary,
  OccupationOption,
  PagedResult,
  RelationResponse,
  RevealedTaxIdentifierResponse,
  SetCustomerFiscalProfileRequest,
  SetRelationFiscalProfileRequest,
  UpdateCustomerRequest,
} from './clients.model';

interface SearchParams {
  term?: string;
  status?: CustomerStatusFilter;
  page?: number;
  size?: number;
  /** Sin `kind` = individuos y empresas. */
  kind?: CustomerKind;
  sort?: CustomerListSort;
}

/** Cliente HTTP fino sobre CustomerController (`/customers`, servicio Customer.Api vía Gateway). */
@Injectable({ providedIn: 'root' })
export class ClientsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/customers');
  }

  /** GET /customers/occupations?q= — catálogo curado para el picker de ocupación (individuo). */
  listOccupations(q?: string): Observable<OccupationOption[]> {
    let params = new HttpParams();
    if (q && q.trim()) {
      params = params.set('q', q.trim());
    }
    return this.http.get<OccupationOption[]>(`${this.base}/occupations`, { params });
  }

  /** GET /customers/business-activities?q= — catálogo NAICS para el picker de actividad (empresa). */
  listBusinessActivities(q?: string): Observable<BusinessActivityOption[]> {
    let params = new HttpParams();
    if (q && q.trim()) {
      params = params.set('q', q.trim());
    }
    return this.http.get<BusinessActivityOption[]>(`${this.base}/business-activities`, { params });
  }

  /**
   * Con término → POST /customers/search (el término, a menudo un email, va en el cuerpo: la URL
   * acaba en los logs del Gateway). Sin término → GET /customers, que conserva la revalidación 304.
   * Mismos filtros, orden y paginación en ambos casos.
   */
  search(params: SearchParams): Observable<PagedResult<CustomerSummary>> {
    if (params.term) {
      return this.http.post<PagedResult<CustomerSummary>>(
        `${this.base}/search`,
        {
          term: params.term,
          status: params.status || undefined,
          page: params.page || undefined,
          size: params.size || undefined,
          kind: params.kind || undefined,
          sort: params.sort?.field,
          dir: params.sort?.dir,
        },
        { context: readOnlyRequestContext() },
      );
    }
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
    if (params.kind) {
      query = query.set('kind', params.kind);
    }
    if (params.sort) {
      query = query.set('sort', params.sort.field).set('dir', params.sort.dir);
    }
    return this.http.get<PagedResult<CustomerSummary>>(this.base, { params: query });
  }

  /** GET /customers/check-exists?email=&taxIdentifier= — preflight de duplicados (al menos uno requerido). */
  checkExists(email?: string, taxIdentifier?: string): Observable<CustomerExistsResponse> {
    let query = new HttpParams();
    if (email) {
      query = query.set('email', email);
    }
    if (taxIdentifier) {
      query = query.set('taxIdentifier', taxIdentifier);
    }
    return this.http.get<CustomerExistsResponse>(`${this.base}/check-exists`, { params: query });
  }

  /** Detalle completo: escalares + addresses/contactPoints/relations/fiscalProfile (enmascarado). */
  getById(id: string): Observable<CustomerDetailResponse> {
    return this.http.get<CustomerDetailResponse>(`${this.base}/${id}`);
  }

  create(req: CreateCustomerRequest): Observable<Customer> {
    return this.http.post<Customer>(this.base, req);
  }

  update(id: string, req: UpdateCustomerRequest): Observable<Customer> {
    return this.http.patch<Customer>(`${this.base}/${id}`, req);
  }

  /** archive/reactivate/activate/deactivate — todas 204 No Content, requieren rol TenantAdmin en el backend. */
  changeStatus(id: string, action: CustomerStatusAction): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/${action}`, {});
  }

  /** POST /customers/bulk/{statusAction} — acción de estado masiva. 200 con posibles fallos parciales. */
  bulkStatus(
    action: CustomerStatusAction,
    customerIds: string[],
    reason?: string | null,
  ): Observable<BulkStatusActionResponse> {
    const body: BulkStatusActionRequest = { customerIds, reason: reason ?? null };
    return this.http.post<BulkStatusActionResponse>(`${this.base}/bulk/${action}`, body);
  }

  // ---------- Asignación de staff (acceso por cliente, M:N) ----------

  /** PUT /customers/{id}/preparer — fija al responsable (primary). Degrada a cualquier otro primary. */
  assignPreparer(id: string, userId: string): Observable<void> {
    return this.http.put<void>(`${this.base}/${id}/preparer`, { preparerUserId: userId });
  }

  /** DELETE /customers/{id}/preparer — quita al responsable (los accesos adicionales quedan). */
  unassignPreparer(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/preparer`);
  }

  /** POST /customers/{id}/assignees — da acceso adicional (no-primary) a un miembro del staff. */
  grantAccess(id: string, userId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/assignees`, { userId });
  }

  /** DELETE /customers/{id}/assignees/{userId} — revoca el acceso de un miembro del staff. */
  revokeAccess(id: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/assignees/${userId}`);
  }

  /** POST /customers/assignees/bulk — asigna UN usuario a MUCHOS clientes (reparto de cartera). */
  bulkAssign(userId: string, customerIds: string[]): Observable<BulkAssignResponse> {
    const body: BulkAssignRequest = { userId, customerIds };
    return this.http.post<BulkAssignResponse>(`${this.base}/assignees/bulk`, body);
  }

  /** PUT /customers/{id}/fiscal-profile — SSN/ITIN/EIN. Requiere rol TenantAdmin; un TenantEmployee recibe 403. */
  setFiscalProfile(id: string, req: SetCustomerFiscalProfileRequest): Observable<unknown> {
    return this.http.put(`${this.base}/${id}/fiscal-profile`, req);
  }

  /** Reveal auditado del identificador fiscal completo — permiso `customers.fiscalprofile.reveal`, rate-limit propio. */
  revealTaxIdentifier(id: string): Observable<RevealedTaxIdentifierResponse> {
    return this.http.get<RevealedTaxIdentifierResponse>(`${this.base}/${id}/fiscal-profile/tax-identifier`);
  }

  // ---------- Direcciones ----------

  addAddress(customerId: string, req: AddAddressRequest): Observable<AddressResponse> {
    return this.http.post<AddressResponse>(`${this.base}/${customerId}/addresses`, req);
  }

  updateAddress(customerId: string, addressId: string, req: AddAddressRequest): Observable<AddressResponse> {
    return this.http.patch<AddressResponse>(`${this.base}/${customerId}/addresses/${addressId}`, req);
  }

  deleteAddress(customerId: string, addressId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${customerId}/addresses/${addressId}`);
  }

  // ---------- Contactos ----------

  addContactPoint(customerId: string, req: AddContactPointRequest): Observable<ContactPointResponse> {
    return this.http.post<ContactPointResponse>(`${this.base}/${customerId}/contact-points`, req);
  }

  updateContactPoint(customerId: string, contactPointId: string, req: AddContactPointRequest): Observable<ContactPointResponse> {
    return this.http.patch<ContactPointResponse>(`${this.base}/${customerId}/contact-points/${contactPointId}`, req);
  }

  deleteContactPoint(customerId: string, contactPointId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${customerId}/contact-points/${contactPointId}`);
  }

  // ---------- Relaciones (cónyuge, dependientes, etc.) ----------

  addRelation(customerId: string, req: AddRelationRequest): Observable<RelationResponse> {
    return this.http.post<RelationResponse>(`${this.base}/${customerId}/relations`, req);
  }

  /** PATCH responde 204 sin body (el backend no devuelve la relación actualizada). */
  updateRelation(customerId: string, relationId: string, req: AddRelationRequest): Observable<void> {
    return this.http.patch<void>(`${this.base}/${customerId}/relations/${relationId}`, req);
  }

  deleteRelation(customerId: string, relationId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${customerId}/relations/${relationId}`);
  }

  /** Perfil fiscal de una relación (SSN del cónyuge/dependiente). Responde 200 con el last4. */
  setRelationFiscalProfile(
    customerId: string,
    relationId: string,
    req: SetRelationFiscalProfileRequest,
  ): Observable<unknown> {
    return this.http.put(`${this.base}/${customerId}/relations/${relationId}/fiscal-profile`, req);
  }
}
