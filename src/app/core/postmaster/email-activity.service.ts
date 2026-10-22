import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { EmailActivityDetail, EmailActivityFilter, EmailActivityPage } from './email-activity.model';

export interface EmailActivityQuery {
  status: EmailActivityFilter;
  recipient: string;
  page: number;
  size: number;
}

/**
 * Cliente HTTP de "Email activity" (Postmaster):
 *   - GET /postmaster/messages?status&recipient&page&size → página del historial.
 *   - GET /postmaster/messages/{id} → detalle con destinatarios y línea de tiempo.
 * Permiso: postmaster.messages.read. El backend enmascara las direcciones para quien no es admin.
 */
@Injectable({ providedIn: 'root' })
export class EmailActivityService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/postmaster/messages');
  }

  list(query: EmailActivityQuery): Observable<EmailActivityPage> {
    let params = new HttpParams().set('page', query.page).set('size', query.size);
    if (query.status !== 'All') {
      params = params.set('status', query.status);
    }
    const recipient = query.recipient.trim();
    if (recipient) {
      params = params.set('recipient', recipient);
    }
    return this.http.get<EmailActivityPage>(this.base, { params });
  }

  get(id: string): Observable<EmailActivityDetail> {
    return this.http.get<EmailActivityDetail>(`${this.base}/${id}`);
  }
}
