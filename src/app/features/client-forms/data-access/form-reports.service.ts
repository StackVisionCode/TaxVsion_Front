import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from '@core/config/api-config.service';
import { Observable } from 'rxjs';
import type {
  FormReportAnswerRow,
  FormReportAnswersFilters,
  FormReportKeysResponse,
  FormReportSummaryResponse,
  PagedResult,
} from './client-forms.model';

/** Archivo CSV listo para guardar: bytes + el nombre que dio el backend. */
export interface FormReportCsvFile {
  blob: Blob;
  fileName: string;
}

@Injectable({ providedIn: 'root' })
export class FormReportsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/tasks/forms/reports');
  }

  keys(templateId: string): Observable<FormReportKeysResponse> {
    const params = new HttpParams().set('templateId', templateId);
    return this.http.get<FormReportKeysResponse>(`${this.base}/keys`, { params });
  }

  answers(filters: FormReportAnswersFilters): Observable<PagedResult<FormReportAnswerRow>> {
    let params = new HttpParams().set('templateId', filters.templateId).set('key', filters.key);
    if (filters.value) params = params.set('value', filters.value);
    if (filters.contains) params = params.set('contains', filters.contains);
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    params = params.set('page', filters.page ?? 1);
    return this.http.get<PagedResult<FormReportAnswerRow>>(`${this.base}/answers`, { params });
  }

  summary(templateId: string, key: string): Observable<FormReportSummaryResponse> {
    const params = new HttpParams().set('templateId', templateId).set('key', key);
    return this.http.get<FormReportSummaryResponse>(`${this.base}/summary`, { params });
  }

  /** El export viene como `text/csv` con el nombre en Content-Disposition; se lee el response completo. */
  export(
    templateId: string,
    from: string | null,
    to: string | null,
  ): Observable<HttpResponse<Blob>> {
    let params = new HttpParams().set('templateId', templateId);
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get(`${this.base}/export`, {
      params,
      responseType: 'blob',
      observe: 'response',
    });
  }
}
