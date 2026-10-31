import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { readOnlyRequestContext } from '@core/http/read-only-request';
import { CustomerDirectoryEntry, DirectoryPage, EmployeeDirectoryEntry } from './chat.model';

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

  /** F8c (T-14): página del rail Team; sin término = primera página por nombre. */
  pageEmployees(term: string | null, cursor: string | null = null): Observable<DirectoryPage<EmployeeDirectoryEntry>> {
    let params = new HttpParams();
    if (term) {
      params = params.set('q', term);
    }
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.http.get<DirectoryPage<EmployeeDirectoryEntry>>(`${this.base}/employees/page`, { params });
  }

  /** F8c (T-14): página del rail Clients (ABAC en el servidor); el término va en el cuerpo. */
  pageCustomers(term: string | null, cursor: string | null = null): Observable<DirectoryPage<CustomerDirectoryEntry>> {
    return this.http.post<DirectoryPage<CustomerDirectoryEntry>>(
      `${this.base}/customers/page`,
      { ...(term ? { q: term } : {}), ...(cursor ? { cursor } : {}) },
      { context: readOnlyRequestContext() },
    );
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
