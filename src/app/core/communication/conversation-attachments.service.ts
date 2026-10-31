import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';

/** F8d: metadata y estado del escaneo de un adjunto (mediado por Communication). */
export interface AttachmentMetaDto {
  fileId: string;
  fileName: string | null;
  sizeBytes: number | null;
  contentType: string | null;
  status: 'Pending' | 'Available' | 'Infected' | 'Deleted' | 'BlockedByPolicy' | 'PendingReview';
}

/** F8d: subida mediada de un adjunto (URL presignada de MinIO). */
export interface InitiatedAttachmentUpload {
  fileId: string;
  uploadUrl: string;
  formData: Record<string, string>;
  expiresAtUtc: string;
}

/**
 * Adjuntos de una conversación mediados por Communication (membresía y escaneo los decide el servidor;
 * el CRM no llama a CloudStorage directo). Lo usan el chat y la sala de reuniones.
 */
@Injectable({ providedIn: 'root' })
export class ConversationAttachmentsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private url(conversationId: string, suffix = ''): string {
    return this.api.tenantUrl(`/communication/conversations/${conversationId}/attachments${suffix}`);
  }

  initiateUpload(
    conversationId: string,
    file: { originalName: string; contentType: string; sizeBytes: number },
  ): Observable<InitiatedAttachmentUpload> {
    return this.http.post<InitiatedAttachmentUpload>(this.url(conversationId, '/upload'), file);
  }

  completeUpload(conversationId: string, fileId: string): Observable<{ fileId: string; status: string }> {
    return this.http.post<{ fileId: string; status: string }>(this.url(conversationId, `/${fileId}/complete`), {});
  }

  /** Metadata, tipo real y estado del escaneo (Pending → aún preparándose; rechazado → no disponible). */
  getMeta(conversationId: string, fileId: string): Observable<AttachmentMetaDto> {
    return this.http.get<AttachmentMetaDto>(this.url(conversationId, `/${fileId}`));
  }

  /** URL presignada (solo si está disponible). */
  getDownloadUrl(conversationId: string, fileId: string): Observable<{ downloadUrl: string }> {
    return this.http.post<{ downloadUrl: string }>(this.url(conversationId, `/${fileId}/download-url`), {});
  }
}
