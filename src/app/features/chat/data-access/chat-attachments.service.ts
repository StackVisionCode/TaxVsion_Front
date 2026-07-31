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
