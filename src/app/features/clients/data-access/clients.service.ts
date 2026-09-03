import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  AddAddressRequest,
  AddContactPointRequest,
  AddRelationRequest,
  AddressResponse,
  BulkStatusActionRequest,
  BulkStatusActionResponse,
  BusinessActivityOption,
  ContactPointResponse,
  CreateCustomerRequest,
  Customer,
  CustomerDetailResponse,
  CustomerExistsResponse,
  CustomerStatusAction,
  CustomerStatusFilter,
  CustomerSummary,
  OccupationOption,
  PagedResult,
  RelationResponse,
  RevealedTaxIdentifierResponse,
  SetCustomerFiscalProfileRequest,
  UpdateCustomerRequest,
} from './clients.model';

interface SearchParams {
  term?: string;
  status?: CustomerStatusFilter;
  page?: number;
  size?: number;
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

  search(params: SearchParams): Observable<PagedResult<CustomerSummary>> {
    let query = new HttpParams();
    if (params.term) {
      query = query.set('term', params.term);
    }
    if (params.status) {
      query = query.set('status', params.status);
    }
    if (params.page) {
      query = query.set('page', params.page);
    }
    if (params.size) {
      query = query.set('size', params.size);
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

  updateRelation(customerId: string, relationId: string, req: AddRelationRequest): Observable<RelationResponse> {
    return this.http.patch<RelationResponse>(`${this.base}/${customerId}/relations/${relationId}`, req);
  }

  deleteRelation(customerId: string, relationId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${customerId}/relations/${relationId}`);
  }
}
