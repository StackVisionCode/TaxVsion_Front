import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { OwnerType } from '@core/cloud-storage/cloud-storage.model';
import {
  CreateFolderRequest,
  CreateShareLinkRequest,
  CreatedShareLinkResponse,
  FileResponse,
  FolderContentsResponse,
  FolderResponse,
  FolderTreeNode,
  RecycleBinItemResponse,
  ShareLinkResponse,
  StorageUsageResponse,
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

  /** Un nivel de carpetas de un dueño. Office = ownerType Tenant (sin ownerId); cliente = Customer + su id. */
  getFolderContents(
    ownerType: OwnerType,
    ownerId: string | null,
    parentFolderId: string | null,
  ): Observable<FolderContentsResponse> {
    let params = new HttpParams().set('ownerType', ownerType);
    if (ownerId) {
      params = params.set('ownerId', ownerId);
    }
    if (parentFolderId) {
      params = params.set('parentFolderId', parentFolderId);
    }
    return this.http.get<FolderContentsResponse>(`${this.base}/folders`, { params });
  }

  /** Árbol completo de carpetas de un dueño (para el destino de "mover"). */
  getFolderTree(ownerType: OwnerType, ownerId: string | null): Observable<FolderTreeNode[]> {
    let params = new HttpParams().set('ownerType', ownerType);
    if (ownerId) {
      params = params.set('ownerId', ownerId);
    }
    return this.http.get<FolderTreeNode[]>(`${this.base}/folders/tree`, { params });
  }

  createFolder(req: CreateFolderRequest): Observable<FolderResponse> {
    return this.http.post<FolderResponse>(`${this.base}/folders`, req);
  }

  renameFolder(folderId: string, newName: string): Observable<FolderResponse> {
    return this.http.put<FolderResponse>(`${this.base}/folders/${folderId}/rename`, { newName });
  }

  moveFolder(folderId: string, newParentFolderId: string | null): Observable<FolderResponse> {
    return this.http.put<FolderResponse>(`${this.base}/folders/${folderId}/move`, { newParentFolderId });
  }

  deleteFolder(folderId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/folders/${folderId}`);
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

  /** Cuota/uso del tenant (footer del navegador + panel de almacenamiento). */
  getUsage(): Observable<StorageUsageResponse> {
    return this.http.get<StorageUsageResponse>(`${this.base}/usage`);
  }

  /** Habilita/deshabilita los enlaces públicos de la firma (requiere permiso de gestión de ajustes). */
  setPublicSharing(allow: boolean): Observable<void> {
    return this.http.put<void>(`${this.base}/settings/public-sharing`, { allow });
  }

  /** Crea un link de compartir para un archivo — plainToken solo viene en esta respuesta. */
  createShareLink(fileId: string, req: CreateShareLinkRequest): Observable<CreatedShareLinkResponse> {
    return this.http.post<CreatedShareLinkResponse>(`${this.base}/files/${fileId}/shares`, req);
  }

  /** Los links activos/históricos creados sobre un archivo (para gestionarlos: ver/revocar). */
  listFileShares(fileId: string): Observable<ShareLinkResponse[]> {
    return this.http.get<ShareLinkResponse[]>(`${this.base}/files/${fileId}/shares`);
  }

  /** Revoca un link de compartir (irreversible). */
  revokeShareLink(shareLinkId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/shares/${shareLinkId}`);
  }

  /** Lo compartido conmigo. */
  listSharedWithMe(): Observable<ShareLinkResponse[]> {
    return this.http.get<ShareLinkResponse[]>(`${this.base}/shares/shared-with-me`, {
      params: new HttpParams().set('take', 100),
    });
  }

  /** ZIP de varios archivos (descarga múltiple) — devuelve el binario para bajarlo con un ancla. */
  downloadZip(fileIds: string[]): Observable<Blob> {
    return this.http.post(`${this.base}/files/zip`, { fileIds, folderIds: [] }, { responseType: 'blob' });
  }
}
