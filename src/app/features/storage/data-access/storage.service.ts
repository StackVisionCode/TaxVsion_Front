import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { FileResponse } from '@core/cloud-storage/cloud-storage.model';
import { RecycleBinEntry, ShareLinkResponse, SharerSummary, StorageUsageResponse } from './storage.model';

/**
 * Cliente HTTP fino del feature Storage sobre CloudStorage.Api (`/storage` vía
 * Gateway) — uso/cuota, listado global de archivos (para el desglose por
 * categoría del donut), shared-with-me y papelera. La descarga (download-url)
 * y la metadata por archivo se reutilizan de `@core/cloud-storage/cloud-storage-upload.service.ts`.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/storage');
  }

  /** GET /storage/usage — cuota del tenant. Requiere el permiso cloudstorage `settings.manage` (403 si no). */
  getUsage(): Observable<StorageUsageResponse> {
    return this.http.get<StorageUsageResponse>(`${this.base}/usage`);
  }

  /** GET /storage/files?skip=&take= — todos los archivos del tenant (take se clampa a 100 en el backend). */
  listFiles(skip: number, take: number): Observable<FileResponse[]> {
    const params = new HttpParams().set('skip', skip).set('take', take);
    return this.http.get<FileResponse[]>(`${this.base}/files`, { params });
  }

  /** GET /storage/shares/shared-with-me?skip=&take= — links Activos donde soy destinatario (TenantOnly o SpecificUsers). */
  listSharedWithMe(skip: number, take: number): Observable<ShareLinkResponse[]> {
    const params = new HttpParams().set('skip', skip).set('take', take);
    return this.http.get<ShareLinkResponse[]>(`${this.base}/shares/shared-with-me`, { params });
  }

  /** GET /storage/recycle-bin — para el grupo "Trash". Requiere `recyclebin.manage` (best-effort en el store). */
  listRecycleBin(take: number): Observable<RecycleBinEntry[]> {
    return this.http.get<RecycleBinEntry[]>(`${this.base}/recycle-bin`, {
      params: new HttpParams().set('take', take),
    });
  }

  /** GET /auth/users/{id} — nombre de quien compartió. Requiere `users.view` (best-effort en el store). */
  getSharer(userId: string): Observable<SharerSummary> {
    return this.http.get<SharerSummary>(`${this.api.tenantUrl('/auth')}/users/${userId}`);
  }
}
