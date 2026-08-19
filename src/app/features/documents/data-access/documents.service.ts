import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  CreateFolderRequest,
  FileResponse,
  FolderContentsResponse,
  FolderResponse,
  RecycleBinItemResponse,
} from './documents.model';

/**
 * Cliente HTTP fino sobre CloudStorage.Api (`/storage`, servicio CloudStorage vía Gateway) —
 * navegación de carpetas, borrado y papelera. El flujo genérico de subida/descarga vive en
 * `@core/cloud-storage/cloud-storage-upload.service.ts` (compartido con `features/chat`).
 */
@Injectable({ providedIn: 'root' })
export class DocumentsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/storage');
  }

  getFolderContents(ownerId: string, parentFolderId: string | null): Observable<FolderContentsResponse> {
    let params = new HttpParams().set('ownerType', 'Customer').set('ownerId', ownerId);
    if (parentFolderId) {
      params = params.set('parentFolderId', parentFolderId);
    }
    return this.http.get<FolderContentsResponse>(`${this.base}/folders`, { params });
  }

  createFolder(req: CreateFolderRequest): Observable<FolderResponse> {
    return this.http.post<FolderResponse>(`${this.base}/folders`, req);
  }

  moveFileToFolder(fileId: string, folderId: string | null): Observable<void> {
    return this.http.put<void>(`${this.base}/files/${fileId}/folder`, { folderId });
  }

  deleteFile(fileId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/files/${fileId}`);
  }

  listRecycleBin(): Observable<RecycleBinItemResponse[]> {
    return this.http.get<RecycleBinItemResponse[]>(`${this.base}/recycle-bin`, {
      params: new HttpParams().set('take', 100),
    });
  }

  restoreFile(fileId: string): Observable<FileResponse> {
    return this.http.post<FileResponse>(`${this.base}/recycle-bin/restore/${fileId}`, {});
  }

  emptyRecycleBin(): Observable<{ purgedCount: number }> {
    return this.http.delete<{ purgedCount: number }>(`${this.base}/recycle-bin/empty`);
  }
}
