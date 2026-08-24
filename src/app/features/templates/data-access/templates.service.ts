import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  AddVersionRequest,
  CreateEmailTemplateRequest,
  EmailTemplateDetailResponse,
  EmailTemplateResponse,
  EmailTemplateVersionResponse,
} from './templates.model';

/**
 * Cliente HTTP fino sobre EmailTemplatesController (`/notifications/email/templates`,
 * servicio Notification vía Gateway). El cuerpo HTML no viaja por estos endpoints:
 * vive en CloudStorage y se baja con el `htmlFileId` de la versión (lo resuelve el store).
 */
@Injectable({ providedIn: 'root' })
export class TemplatesService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/notifications/email/templates');
  }

  /** GET — lista completa (sin paginar) de plantillas System + Tenant. */
  list(): Observable<EmailTemplateResponse[]> {
    return this.http.get<EmailTemplateResponse[]>(this.base);
  }

  /** GET /{id} — metadata + todas las versiones (para leer el cuerpo y el historial). */
  getById(id: string): Observable<EmailTemplateDetailResponse> {
    return this.http.get<EmailTemplateDetailResponse>(`${this.base}/${id}`);
  }

  /** POST — crea la plantilla vacía (sin cuerpo aún: eso es una versión aparte). */
  create(request: CreateEmailTemplateRequest): Observable<EmailTemplateResponse> {
    return this.http.post<EmailTemplateResponse>(this.base, request);
  }

  /** POST /{id}/versions — cada guardado del cuerpo crea una versión inmutable nueva. */
  addVersion(id: string, request: AddVersionRequest): Observable<EmailTemplateVersionResponse> {
    return this.http.post<EmailTemplateVersionResponse>(`${this.base}/${id}/versions`, request);
  }

  /** POST /{id}/publish — activa una versión concreta (204). */
  publish(id: string, versionId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/publish`, { versionId });
  }

  /** POST /{id}/archive — no hay DELETE en el backend: las plantillas se archivan (204). */
  archive(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/archive`, {});
  }
}
