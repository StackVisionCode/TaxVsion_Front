import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from '@core/config/api-config.service';
import type { Observable } from 'rxjs';
import type { PagedResult } from './client-forms.model';
import type {
  FormInsightsPeriod,
  FormInsightsSummary,
  FormInsightsTemplateRow,
} from './form-insights.model';

/** Insights de Client Forms (`tasks/forms/insights`, lectura con `tasks.form_requests.read`). */
@Injectable({ providedIn: 'root' })
export class FormInsightsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/tasks/forms/insights');
  }

  /** `utcOffsetMinutes`: desfase local del navegador, para que los días del gráfico sean los de la oficina. */
  summary(
    period: FormInsightsPeriod,
    templateId: string | null,
    utcOffsetMinutes: number,
  ): Observable<FormInsightsSummary> {
    let params = new HttpParams().set('period', period).set('utcOffsetMinutes', utcOffsetMinutes);
    if (templateId) params = params.set('templateId', templateId);
    return this.http.get<FormInsightsSummary>(`${this.base}/summary`, { params });
  }

  templates(
    period: FormInsightsPeriod,
    page: number,
    size: number,
    utcOffsetMinutes: number,
  ): Observable<PagedResult<FormInsightsTemplateRow>> {
    const params = new HttpParams()
      .set('period', period)
      .set('page', page)
      .set('size', size)
      .set('utcOffsetMinutes', utcOffsetMinutes);
    return this.http.get<PagedResult<FormInsightsTemplateRow>>(`${this.base}/templates`, {
      params,
    });
  }
}
