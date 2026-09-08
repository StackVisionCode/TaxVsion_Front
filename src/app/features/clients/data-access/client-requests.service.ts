import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  ClientRequestResponse,
  CreateClientRequestRequest,
  ResolveClientRequestRequest,
} from './client-requests.model';

/**
 * Cliente HTTP de ClientRequests (TasksController `/tasks/client-requests`). El listado por cliente
 * es el endpoint de staff `GET /tasks/client-requests?customerId=&onlyOpen=` (perm `tasks.read`);
 * crear/resolver requieren `tasks.client_requests.manage`.
 */
@Injectable({ providedIn: 'root' })
export class ClientRequestsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/tasks/client-requests');
  }

  /** GET /tasks/client-requests?customerId=&onlyOpen= — todo lo pedido a este cliente. */
  byCustomer(customerId: string, onlyOpen = false): Observable<ClientRequestResponse[]> {
    const params = new HttpParams().set('customerId', customerId).set('onlyOpen', onlyOpen);
    return this.http.get<ClientRequestResponse[]>(this.base, { params });
  }

  create(req: CreateClientRequestRequest): Observable<ClientRequestResponse> {
    return this.http.post<ClientRequestResponse>(this.base, req);
  }

  resolve(id: string, req: ResolveClientRequestRequest): Observable<ClientRequestResponse> {
    return this.http.post<ClientRequestResponse>(`${this.base}/${id}/resolve`, req);
  }
}
