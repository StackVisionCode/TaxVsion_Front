import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from '@core/config/api-config.service';
import type { Observable } from 'rxjs';
import type {
  CreateFormIntakeLinkInput,
  FormIntakeLink,
  FormIntakeLinkAction,
  FormIntakeLinkTokenResponse,
} from './client-forms.model';

/** `FormIntakeLinksController` (`tasks/forms/intake-links`, `tasks.form_intake_links.manage`). */
@Injectable({ providedIn: 'root' })
export class FormIntakeLinksService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/tasks/forms/intake-links');
  }

  list(): Observable<FormIntakeLink[]> {
    return this.http.get<FormIntakeLink[]>(this.base);
  }

  get(id: string): Observable<FormIntakeLink> {
    return this.http.get<FormIntakeLink>(`${this.base}/${id}`);
  }

  /** Token en claro para volver a copiar el enlace (queda auditado en el backend). */
  token(id: string): Observable<FormIntakeLinkTokenResponse> {
    return this.http.get<FormIntakeLinkTokenResponse>(`${this.base}/${id}/token`);
  }

  create(input: CreateFormIntakeLinkInput): Observable<FormIntakeLinkTokenResponse> {
    return this.http.post<FormIntakeLinkTokenResponse>(this.base, input);
  }

  change(
    id: string,
    action: FormIntakeLinkAction,
    rowVersion: string,
  ): Observable<FormIntakeLinkTokenResponse> {
    return this.http.post<FormIntakeLinkTokenResponse>(`${this.base}/${id}/${action}`, {
      rowVersion,
    });
  }

  pinVersion(
    id: string,
    formTemplateVersionId: string,
    rowVersion: string,
  ): Observable<FormIntakeLinkTokenResponse> {
    return this.http.post<FormIntakeLinkTokenResponse>(`${this.base}/${id}/pin-version`, {
      formTemplateVersionId,
      rowVersion,
    });
  }
}
