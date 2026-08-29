import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  DownloadUrlResponse,
  FileResponse,
  InitiateUploadRequest,
  InitiatedUploadResponse,
} from './cloud-storage.model';

/**
 * Cliente HTTP genérico de subida/descarga sobre CloudStorage.Api (`/storage` vía
 * Gateway) — el flujo presigned-POST (initiate → subir a MinIO → complete) más
 * lectura de metadata y link de descarga, compartido por cualquier feature que
 * necesite adjuntar archivos (hoy: `features/documents` y `features/chat`).
 * Lo específico de navegación de carpetas/papelera vive en
 * `features/documents/data-access/documents.service.ts`.
 */
@Injectable({ providedIn: 'root' })
export class CloudStorageUploadService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/storage');
  }

  initiateUpload(req: InitiateUploadRequest): Observable<InitiatedUploadResponse> {
    return this.http.post<InitiatedUploadResponse>(`${this.base}/files/uploads`, req);
  }

  /**
   * Sube el archivo directo a MinIO vía el POST presignado (fuera del Gateway — URL de otro
   * origin). `formData` debe ir antes que el campo del archivo: convención S3 presigned-POST.
   */
  uploadToPresignedUrl(uploadUrl: string, formData: Record<string, string>, file: File): Observable<unknown> {
    const body = new FormData();
    for (const [key, value] of Object.entries(formData)) {
      body.append(key, value);
    }
    body.append('file', file);
    return this.http.post(uploadUrl, body);
  }

  completeUpload(fileId: string): Observable<{ fileId: string; status: string }> {
    return this.http.post<{ fileId: string; status: string }>(`${this.base}/files/${fileId}/complete`, {});
  }

  getFile(fileId: string): Observable<FileResponse> {
    return this.http.get<FileResponse>(`${this.base}/files/${fileId}`);
  }

  /**
   * GET /storage/files — archivos del tenant (staff), más recientes primero. El backend
   * NO filtra por tipo/cliente para staff, así que el filtrado (PDF, Available, owner) se
   * hace en el cliente. `take` va acotado 1..100 por el backend.
   */
  listFiles(skip = 0, take = 100): Observable<FileResponse[]> {
    const params = new HttpParams().set('skip', skip).set('take', take);
    return this.http.get<FileResponse[]>(`${this.base}/files`, { params });
  }

  getDownloadUrl(fileId: string): Observable<DownloadUrlResponse> {
    return this.http.post<DownloadUrlResponse>(`${this.base}/files/${fileId}/download-url`, {});
  }
}
