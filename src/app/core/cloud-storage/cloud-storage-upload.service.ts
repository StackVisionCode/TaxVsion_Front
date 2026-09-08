import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  DownloadUrlResponse,
  FileResponse,
  InitiateUploadRequest,
  InitiatedUploadResponse,
  OwnerType,
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
   * GET /storage/files — listado plano de archivos, más recientes primero. Para staff se
   * puede acotar a UN dueño (`ownerType`/`ownerId`, ej. todos los de un customer cross-carpeta);
   * un actor de portal ignora ese filtro y solo ve lo suyo. `take` va acotado 1..100 por el backend.
   */
  listFiles(skip = 0, take = 100, ownerType?: OwnerType, ownerId?: string | null): Observable<FileResponse[]> {
    let params = new HttpParams().set('skip', skip).set('take', take);
    if (ownerType) {
      params = params.set('ownerType', ownerType);
    }
    if (ownerId) {
      params = params.set('ownerId', ownerId);
    }
    return this.http.get<FileResponse[]>(`${this.base}/files`, { params });
  }

  getDownloadUrl(fileId: string): Observable<DownloadUrlResponse> {
    return this.http.post<DownloadUrlResponse>(`${this.base}/files/${fileId}/download-url`, {});
  }
}
