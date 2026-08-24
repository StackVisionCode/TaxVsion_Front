import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { PagedResult } from './clients.model';
import { CLIENT_THREADS_PAGE_SIZE, ClientThreadSummary } from './client-communication.model';

/**
 * Cliente HTTP fino sobre `ThreadsController` (`/correspondence`, Correspondence.Api).
 *
 * Solo se usa el listado por customer: es el único endpoint del backend que asocia
 * actividad de comunicación a un cliente concreto. El JWT lo pone el interceptor global.
 * Requiere el permiso `CorrespondencePermissions.Read`; sin él responde 403 y el store
 * muestra el mensaje del backend en vez de una lista vacía engañosa.
 */
@Injectable({ providedIn: 'root' })
export class ClientCommunicationService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/correspondence');
  }

  /** GET /correspondence/customers/{customerId}/threads — hilos de email de ESTE cliente. */
  listThreads(
    clientId: string,
    page = 1,
    size = CLIENT_THREADS_PAGE_SIZE,
  ): Observable<PagedResult<ClientThreadSummary>> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<PagedResult<ClientThreadSummary>>(`${this.base}/customers/${clientId}/threads`, {
      params,
    });
  }
}
