import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { TokenService } from '@core/auth/token.service';
import { ApiConfigService } from '@core/config/api-config.service';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import { Observable, map } from 'rxjs';
import type {
  ClientFormsAvailability,
  CreateFormTemplateInput,
  DraftUpdateOutcome,
  FormTemplateDetail,
  FormTemplateSummary,
  FormTemplateVersion,
  FormTemplateVersionSummary,
  PagedResult,
  PublishOutcome,
  TemplateFilters,
  TemplateValidationResponse,
} from './client-forms.model';

@Injectable({ providedIn: 'root' })
export class FormTemplatesService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private readonly tokens = inject(TokenService);

  private get base(): string {
    return this.api.tenantUrl('/tasks/forms');
  }

  availability(): Observable<ClientFormsAvailability> {
    return this.http.get<ClientFormsAvailability>(`${this.base}/availability`);
  }

  list(filters: TemplateFilters = {}): Observable<PagedResult<FormTemplateSummary>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value != null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<PagedResult<FormTemplateSummary>>(`${this.base}/templates`, { params });
  }

  create(input: CreateFormTemplateInput): Observable<FormTemplateDetail> {
    return this.http.post<FormTemplateDetail>(`${this.base}/templates`, input);
  }

  get(id: string): Observable<FormTemplateDetail> {
    return this.http.get<FormTemplateDetail>(`${this.base}/templates/${id}`);
  }

  rename(id: string, name: string, description: string | null, rowVersion: string): Observable<FormTemplateDetail> {
    return this.http.patch<FormTemplateDetail>(`${this.base}/templates/${id}`, {
      name,
      description,
      rowVersion,
    });
  }

  updateDraft(id: string, definition: FormDefinition, rowVersion: string): Observable<DraftUpdateOutcome> {
    return this.http.put<DraftUpdateOutcome>(`${this.base}/templates/${id}/draft`, {
      definition,
      rowVersion,
    });
  }

  /** Guardado en `pagehide`: `fetch` con keepalive y bearer (no `sendBeacon`, que no lleva Authorization). */
  updateDraftKeepalive(id: string, definition: FormDefinition, rowVersion: string): void {
    const token = this.tokens.getAccessToken();
    if (!token) return;
    void fetch(`${this.base}/templates/${id}/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ definition, rowVersion }),
      keepalive: true,
    }).catch(() => undefined);
  }

  validate(id: string): Observable<TemplateValidationResponse> {
    return this.http.post<TemplateValidationResponse>(`${this.base}/templates/${id}/validate`, {});
  }

  // El backend responde 200 con la versión publicada y 422 con los issues (lo maneja el store).
  publish(id: string, rowVersion: string): Observable<PublishOutcome> {
    return this.http
      .post<FormTemplateVersion>(`${this.base}/templates/${id}/publish`, { rowVersion })
      .pipe(map((version) => ({ published: true, version, issues: [] })));
  }

  archive(id: string, rowVersion: string): Observable<FormTemplateDetail> {
    return this.http.post<FormTemplateDetail>(`${this.base}/templates/${id}/archive`, { rowVersion });
  }

  restore(id: string, rowVersion: string): Observable<FormTemplateDetail> {
    return this.http.post<FormTemplateDetail>(`${this.base}/templates/${id}/restore`, { rowVersion });
  }

  duplicate(id: string, fromVersionNumber: number | null = null): Observable<FormTemplateDetail> {
    return this.http.post<FormTemplateDetail>(`${this.base}/templates/${id}/duplicate`, {
      fromVersionNumber,
    });
  }

  revert(id: string, versionNumber: number, rowVersion: string): Observable<FormTemplateDetail> {
    return this.http.post<FormTemplateDetail>(`${this.base}/templates/${id}/revert`, {
      versionNumber,
      rowVersion,
    });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/templates/${id}`);
  }

  versions(id: string): Observable<FormTemplateVersionSummary[]> {
    return this.http.get<FormTemplateVersionSummary[]>(`${this.base}/templates/${id}/versions`);
  }

  version(id: string, versionNumber: number): Observable<FormTemplateVersion> {
    return this.http.get<FormTemplateVersion>(`${this.base}/templates/${id}/versions/${versionNumber}`);
  }
}
