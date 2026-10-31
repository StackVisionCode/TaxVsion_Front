import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { ChatService } from './chat.service';

/**
 * Adjuntos de chat. F8d (ADD-01 §13.5): la subida va MEDIADA por Communication (como el portal): pide la URL
 * presignada (Communication verifica membresía y decide carpeta: adjunto → la conversación; audio → "Voice
 * Notes" del tenant), el navegador sube el binario directo a MinIO y Communication confirma (dispara el escaneo).
 */
@Injectable({ providedIn: 'root' })
export class ChatAttachmentsService {
  private readonly chat = inject(ChatService);
  private readonly cloudStorage = inject(CloudStorageUploadService);

  /** Sube el archivo y devuelve el `fileId` ya confirmado. */
  uploadAttachment(conversationId: string, file: File): Observable<string> {
    return this.upload(conversationId, file, file.type || 'application/octet-stream');
  }

  /** Nota de voz: `file.type` debe ser audio/webm|audio/mp4 (Communication la lleva a "Voice Notes"). */
  uploadVoiceNote(conversationId: string, file: File): Observable<string> {
    return this.upload(conversationId, file, file.type || 'audio/webm');
  }

  private upload(conversationId: string, file: File, contentType: string): Observable<string> {
    return this.chat.initiateAttachmentUpload(conversationId, { originalName: file.name, contentType, sizeBytes: file.size }).pipe(
      switchMap(initiated =>
        // El binario va directo a MinIO con la URL presignada (no es la API de CloudStorage).
        this.cloudStorage.uploadToPresignedUrl(initiated.uploadUrl, initiated.formData, file).pipe(
          switchMap(() => this.chat.completeAttachmentUpload(conversationId, initiated.fileId)),
          map(() => initiated.fileId),
        ),
      ),
    );
  }
}
