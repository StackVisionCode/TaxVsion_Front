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

/** Espejo del query param `status` de GET /customers (CustomerStatusFilter). */
export type DocumentsClientStatusFilter = 'NotArchived' | 'Active' | 'Inactive' | 'Archived' | 'All';

export interface DocumentsClientQuery {
  term?: string;
  status?: DocumentsClientStatusFilter;
  page?: number;
  size?: number;
}

interface PagedResult<T> {
  items: T[];
  totalCount: number;
}

/** Cliente HTTP fino sobre GET /customers, solo para el selector del módulo Documents. */
@Injectable({ providedIn: 'root' })
export class DocumentsClientsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/customers');
  }

  /**
   * Búsqueda paginada server-side. La paginación es del backend a propósito: la oficina
   * puede tener miles de clientes y traerlos todos para filtrar en memoria no escala.
   */
  search(query: DocumentsClientQuery = {}): Observable<PagedResult<DocumentsClientSummary>> {
    let params = new HttpParams().set('status', query.status ?? 'NotArchived');
    if (query.term?.trim()) {
      params = params.set('term', query.term.trim());
    }
    if (query.page) {
      params = params.set('page', query.page);
    }
    if (query.size) {
      params = params.set('size', query.size);
    }
    return this.http.get<PagedResult<DocumentsClientSummary>>(this.base, { params });
  }
}
