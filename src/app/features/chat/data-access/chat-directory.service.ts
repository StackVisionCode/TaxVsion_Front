import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { readOnlyRequestContext } from '@core/http/read-only-request';
import { CustomerDirectoryEntry, EmployeeDirectoryEntry } from './chat.model';

/**
 * Cliente HTTP del directorio de Communication (`/communication/directory`), staff-only.
 * - `employees`: compañeros de equipo → `userId` directo para `chat.conversation.start_direct`.
 * - `customers`: clientes → incluye `portalUserId` (userId de Auth de la cuenta de portal
 *   activa, o null). Con eso el CRM inicia el chat con un cliente; los que tienen
 *   `portalUserId == null` no son chateables (sin portal).
 */
@Injectable({ providedIn: 'root' })
export class ChatDirectoryService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/communication/directory');
  }

  searchEmployees(term: string, limit = 10): Observable<EmployeeDirectoryEntry[]> {
    const params = new HttpParams().set('q', term).set('limit', limit);
    return this.http.get<EmployeeDirectoryEntry[]>(`${this.base}/employees`, { params });
  }

  /** POST .../customers/search: el término (a menudo un email) va en el cuerpo, no en la URL. */
  searchCustomers(term: string, limit = 10): Observable<CustomerDirectoryEntry[]> {
    return this.http.post<CustomerDirectoryEntry[]>(
      `${this.base}/customers/search`,
      { q: term, limit },
      { context: readOnlyRequestContext() },
    );
  }
}
