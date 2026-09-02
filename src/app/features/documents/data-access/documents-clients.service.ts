import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';

/**
 * Subset mínimo de TaxVision.Customer.Domain.Customers.CustomerSummary, replicado acá
 * (no importado de features/clients) porque ARCHITECTURE.md prohíbe imports cross-feature
 * — mismo criterio que signature-wizard.mock.ts.
 */
export interface DocumentsClientSummary {
  id: string;
  displayName: string;
  primaryEmail: string;
  status: 'Active' | 'Inactive' | 'Archived';
}

interface PagedResult<T> {
  items: T[];
  totalCount: number;
}

/** Cliente HTTP fino sobre GET /customers, solo para el picker del módulo Documents. */
@Injectable({ providedIn: 'root' })
export class DocumentsClientsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/customers');
  }

  search(term: string): Observable<PagedResult<DocumentsClientSummary>> {
    // Lista para el rail del navegador: página chica + búsqueda server-side (escala a miles
    // de clientes sin volcar todo en el sidebar). El total real viaja en `totalCount`.
    let params = new HttpParams().set('status', 'NotArchived').set('size', 25);
    if (term.trim()) {
      params = params.set('term', term.trim());
    }
    return this.http.get<PagedResult<DocumentsClientSummary>>(this.base, { params });
  }
}
