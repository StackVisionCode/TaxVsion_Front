import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { InitiateUploadRequest } from '@core/cloud-storage/cloud-storage.model';

/**
 * Adjuntos de chat sobre CloudStorage.Api (`/storage`) — Communication nunca valida el
 * archivo, solo guarda el `fileId` que se le manda en `chat.message.send`. No hay un
 * `FolderType` de chat en CloudStorage: se usa `Other` (no exige `taxYear`, whitelist
 * genérica 25MB). `ownerType: 'Communication'` es válido sin restricción de `ownerId`
 * para actores staff (TenantEmployee/TenantAdmin) — se usa el `conversationId`.
 */
@Injectable({ providedIn: 'root' })
export class ChatAttachmentsService {
  private readonly cloudStorage = inject(CloudStorageUploadService);

  /** Sube el archivo y devuelve el `fileId` ya confirmado (initiate → MinIO → complete). */
  uploadAttachment(conversationId: string, file: File): Observable<string> {
    const request: InitiateUploadRequest = {
      originalName: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      ownerType: 'Communication',
      ownerId: conversationId,
      folderType: 'Other',
      taxYear: null,
    };
    return this.upload(request, file);
  }

  /**
   * Sube una nota de voz a la carpeta navegable "Voice Notes" del TENANT (owner Tenant/ownerId=null),
   * no a la conversación — así el staff la ve como una sola carpeta en el gestor (decisión A). El CRM
   * sube directo a CloudStorage (el staff puede crear files Tenant-owned); el Portal va mediado por
   * Communication, que hace el mismo ruteo por content-type. `file.type` debe ser audio/webm|audio/mp4.
   */
  uploadVoiceNote(file: File): Observable<string> {
    const request: InitiateUploadRequest = {
      originalName: file.name,
      contentType: file.type || 'audio/webm',
      sizeBytes: file.size,
      ownerType: 'Tenant',
      ownerId: null,
      folderType: 'VoiceNotes',
      taxYear: null,
    };
    return this.upload(request, file);
  }

  private upload(request: InitiateUploadRequest, file: File): Observable<string> {
    return this.cloudStorage.initiateUpload(request).pipe(
      switchMap(initiated =>
        this.cloudStorage.uploadToPresignedUrl(initiated.uploadUrl, initiated.formData, file).pipe(
          switchMap(() => this.cloudStorage.completeUpload(initiated.fileId)),
          map(() => initiated.fileId),
        ),
      ),
    );
  }
}
