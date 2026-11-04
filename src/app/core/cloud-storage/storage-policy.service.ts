import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, shareReplay, throwError } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { formatBytes } from '@shared/utils/format.util';
import { FolderType, SharingPolicy, UploadPolicy } from './cloud-storage.model';

/**
 * Políticas vigentes de CloudStorage para los formularios: qué se puede subir a cada carpeta y las reglas
 * de compartir de la oficina. Se cachean por sesión (cambian poco; el backend vuelve a validar siempre).
 */
@Injectable({ providedIn: 'root' })
export class StoragePolicyService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private readonly uploadPolicies = new Map<FolderType, Observable<UploadPolicy>>();
  private sharingPolicy$: Observable<SharingPolicy> | null = null;

  private get base(): string {
    return this.api.tenantUrl('/storage');
  }

  uploadPolicy(folderType: FolderType): Observable<UploadPolicy> {
    const cached = this.uploadPolicies.get(folderType);
    if (cached) {
      return cached;
    }
    const request$ = this.http
      .get<UploadPolicy>(`${this.base}/upload-policy`, { params: new HttpParams().set('folderType', folderType) })
      .pipe(
        // Un error no se queda en caché: el próximo intento vuelve a preguntar.
        catchError(err => {
          this.uploadPolicies.delete(folderType);
          return throwError(() => err);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    this.uploadPolicies.set(folderType, request$);
    return request$;
  }

  sharing(): Observable<SharingPolicy> {
    if (!this.sharingPolicy$) {
      this.sharingPolicy$ = this.http.get<SharingPolicy>(`${this.base}/shares/policy`).pipe(
        catchError(err => {
          this.sharingPolicy$ = null;
          return throwError(() => err);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.sharingPolicy$;
  }

  /** Tras cambiar las reglas en Settings, para que el diálogo de compartir lea las nuevas. */
  invalidateSharing(): void {
    this.sharingPolicy$ = null;
  }
}

/**
 * Por qué un archivo no se puede subir con esta política (null = se puede). Sin política no se filtra:
 * el backend vuelve a validar siempre.
 */
export function uploadRejection(file: File, policy: UploadPolicy | null): string | null {
  if (!policy) {
    return null;
  }
  const dot = file.name.lastIndexOf('.');
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!policy.allowedExtensions.includes(extension)) {
    return `${file.name} isn't an accepted file type here.`;
  }
  if (file.size > policy.maxFileSizeBytes) {
    return `${file.name} is larger than ${formatBytes(policy.maxFileSizeBytes, { maxUnit: 'GB' })}.`;
  }
  return null;
}
