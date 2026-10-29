import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from '@core/config/api-config.service';
import type { Observable } from 'rxjs';
import type { FormProspect, FormProspectFilters, PagedResult } from './client-forms.model';

/** Prospects de Client Forms (`tasks/forms/prospects`, lectura con `tasks.form_requests.read`). */
@Injectable({ providedIn: 'root' })
export class FormProspectsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/tasks/forms/prospects');
  }

  list(filters: FormProspectFilters): Observable<PagedResult<FormProspect>> {
    let params = new HttpParams().set('page', filters.page).set('size', filters.size);
    if (filters.status) params = params.set('status', filters.status);
    const search = filters.search?.trim();
    if (search) params = params.set('search', search);
    return this.http.get<PagedResult<FormProspect>>(this.base, { params });
  }

  /** 409 `FormParticipant.AlreadyConverted` si ya es cliente. */
  markLost(participantId: string, reason: string | null): Observable<FormProspect> {
    return this.http.post<FormProspect>(`${this.base}/${participantId}/lost`, { reason });
  }

  reopen(participantId: string): Observable<FormProspect> {
    return this.http.post<FormProspect>(`${this.base}/${participantId}/reopen`, {});
  }
}
