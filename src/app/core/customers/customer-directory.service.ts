import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  CustomerDirectoryOverview,
  CustomerSearchParams,
  CustomerSummary,
  PagedResult,
} from './customer-summary.model';

/** Cliente HTTP fino sobre CustomerController (`/customers`). Solo lectura; lo consume CustomerDirectoryStore. */
@Injectable({ providedIn: 'root' })
export class CustomerDirectoryService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/customers');
  }

  search(params: CustomerSearchParams): Observable<PagedResult<CustomerSummary>> {
    let query = new HttpParams();
    if (params.term?.trim()) {
      query = query.set('term', params.term.trim());
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

  /** GET /customers/overview — resumen del dashboard (total + altas por mes + últimas), agregado en el backend. */
  overview(months = 6): Observable<CustomerDirectoryOverview> {
    return this.http.get<CustomerDirectoryOverview>(`${this.base}/overview`, {
      params: new HttpParams().set('months', months),
    });
  }

  /** GET /customers/{id} → summary. El detalle trae más campos; se recorta al DTO compartido. */
  getById(id: string): Observable<CustomerSummary> {
    return this.http.get<CustomerSummary>(`${this.base}/${id}`).pipe(
      map(c => ({
        id: c.id,
        kind: c.kind,
        status: c.status,
        displayName: c.displayName,
        primaryEmail: c.primaryEmail,
        primaryPhone: c.primaryPhone ?? null,
        createdAtUtc: c.createdAtUtc,
      })),
    );
  }
}
