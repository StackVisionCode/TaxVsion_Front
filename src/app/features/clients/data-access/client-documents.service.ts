import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';

/**
 * Complemento clients-local de CloudStorage para la pestaña Documents del perfil: solo el borrado
 * (`DELETE /storage/files/{id}`, perm `cloudstorage.file.delete`, staff), que no vive en el
 * servicio CORE `CloudStorageUploadService` (ese cubre list/upload/download/metadata, y se reutiliza
 * directamente). Así el listado por cliente y la subida usan el core compartido, y aquí solo se
 * agrega la pieza faltante, sin importar `features/documents`.
 */
@Injectable({ providedIn: 'root' })
export class ClientDocumentsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  /** DELETE /storage/files/{id} — borrado lógico (va a la papelera del tenant). */
  deleteFile(fileId: string): Observable<void> {
    return this.http.delete<void>(this.api.tenantUrl(`/storage/files/${fileId}`));
  }
}
