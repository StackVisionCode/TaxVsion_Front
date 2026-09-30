import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { ClientFolderContents, ClientFolderResponse } from './client-documents.model';

/**
 * Complemento clients-local de CloudStorage para la pestaña Documents del perfil: carpetas del
 * cliente (`/storage/folders` con `ownerType=Customer&ownerId=`), mover un archivo a una carpeta y
 * el borrado — lo que no vive en el servicio CORE `CloudStorageUploadService` (ese cubre
 * upload/download/metadata y se reutiliza directamente). Réplica mínima de los endpoints que usa
 * `features/documents`, sin importarla.
 *
 * Renombrar un ARCHIVO no existe en el backend (FilesController no tiene rename; verificado en
 * origin/Develop): solo las carpetas se renombran.
 */
@Injectable({ providedIn: 'root' })
export class ClientDocumentsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/storage');
  }

  /** GET /storage/folders — un nivel (subcarpetas + archivos) de las carpetas del cliente. null = raíz. */
  getFolderContents(customerId: string, parentFolderId: string | null, take: number): Observable<ClientFolderContents> {
    let params = new HttpParams()
      .set('ownerType', 'Customer')
      .set('ownerId', customerId)
      .set('skip', '0')
      .set('take', take.toString())
      .set('sort', 'Modified')
      .set('desc', 'true');
    if (parentFolderId) {
      params = params.set('parentFolderId', parentFolderId);
    }
    return this.http.get<ClientFolderContents>(`${this.base}/folders`, { params });
  }

  /** POST /storage/folders — carpeta nueva del cliente (perm `cloudstorage.folder.manage`). */
  createFolder(customerId: string, parentFolderId: string | null, name: string): Observable<ClientFolderResponse> {
    return this.http.post<ClientFolderResponse>(`${this.base}/folders`, {
      parentFolderId,
      name,
      ownerType: 'Customer',
      ownerId: customerId,
    });
  }

  /** PUT /storage/folders/{id}/rename. */
  renameFolder(folderId: string, newName: string): Observable<ClientFolderResponse> {
    return this.http.put<ClientFolderResponse>(`${this.base}/folders/${folderId}/rename`, { newName });
  }

  /** PUT /storage/files/{id}/folder — ubica un archivo recién subido en la carpeta abierta. */
  moveFileToFolder(fileId: string, folderId: string | null): Observable<void> {
    return this.http.put<void>(`${this.base}/files/${fileId}/folder`, { folderId });
  }

  /** DELETE /storage/files/{id} — borrado lógico (va a la papelera del tenant). */
  deleteFile(fileId: string): Observable<void> {
    return this.http.delete<void>(this.api.tenantUrl(`/storage/files/${fileId}`));
  }
}
