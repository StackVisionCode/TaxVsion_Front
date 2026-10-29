import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from '@core/config/api-config.service';
import { Observable } from 'rxjs';
import type {
  FormTemplateDetail,
  LibraryTemplatePreview,
  LibraryTemplateSummary,
  RecordLibraryReviewInput,
  SetLibraryListingInput,
} from './client-forms.model';

@Injectable({ providedIn: 'root' })
export class FormLibraryService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/tasks/forms');
  }

  /** Biblioteca para los tenants: solo plantillas de plataforma listadas y revisadas. */
  list(): Observable<LibraryTemplateSummary[]> {
    return this.http.get<LibraryTemplateSummary[]>(`${this.base}/library`);
  }

  preview(key: string): Observable<LibraryTemplatePreview> {
    return this.http.get<LibraryTemplatePreview>(`${this.base}/library/${encodeURIComponent(key)}`);
  }

  clone(key: string): Observable<FormTemplateDetail> {
    return this.http.post<FormTemplateDetail>(`${this.base}/library/${encodeURIComponent(key)}/clone`, {});
  }

  // --- Plataforma (PlatformAdmin) ---

  recordReview(templateId: string, input: RecordLibraryReviewInput): Observable<FormTemplateDetail> {
    return this.http.post<FormTemplateDetail>(`${this.base}/library/${templateId}/reviews`, input);
  }

  setListing(templateId: string, input: SetLibraryListingInput): Observable<FormTemplateDetail> {
    return this.http.put<FormTemplateDetail>(`${this.base}/library/${templateId}/listing`, input);
  }

  exportTemplate(templateId: string): Observable<string> {
    return this.http.get(`${this.base}/templates/${templateId}/export`, { responseType: 'text' });
  }
}
