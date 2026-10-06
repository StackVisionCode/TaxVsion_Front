import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { SignatureRequestListResponse } from './client-signatures.model';

/**
 * Cliente HTTP fino sobre `/signature/requests` para la pestaña "Signatures" del perfil.
 * Autocontenido (no importa `features/signature`): el listado usa el filtro por cliente
 * `customerId` (firmante mapeado a ese Customer) y la cancelación el endpoint dedicado.
 */
@Injectable({ providedIn: 'root' })
export class ClientSignaturesService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/signature/requests');
  }

  /** GET /signature/requests?customerId= — solicitudes de este cliente, más recientes primero (size 1..100). */
  byCustomer(customerId: string, page = 1, size = 100): Observable<SignatureRequestListResponse> {
    const params = new HttpParams().set('customerId', customerId).set('page', page).set('size', size);
    return this.http.get<SignatureRequestListResponse>(this.base, { params });
  }

  /** POST /signature/requests/{id}/cancel — perm `signature.request.cancel`; falla si ya es terminal. */
  cancel(requestId: string, reason: string | null = null): Observable<void> {
    return this.http.post<void>(`${this.base}/${requestId}/cancel`, { reason });
  }
}
