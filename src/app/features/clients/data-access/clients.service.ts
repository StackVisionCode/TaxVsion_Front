import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import {
  CreateCustomerRequest,
  Customer,
  CustomerStatusAction,
  CustomerStatusFilter,
  CustomerSummary,
  PagedResult,
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
  private readonly base = `${environment.apiUrl}/customers`;

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

  getById(id: string): Observable<Customer> {
    return this.http.get<Customer>(`${this.base}/${id}`);
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

  /** PUT /customers/{id}/fiscal-profile — SSN/ITIN/EIN. Requiere rol TenantAdmin; un TenantEmployee recibe 403. */
  setFiscalProfile(id: string, req: SetCustomerFiscalProfileRequest): Observable<unknown> {
    return this.http.put(`${this.base}/${id}/fiscal-profile`, req);
  }
}
