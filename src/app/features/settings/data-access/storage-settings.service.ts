import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { SharingPolicy } from '@core/cloud-storage/cloud-storage.model';

/** Cuerpo de `PUT /storage/settings/sharing`: todo menos los enlaces públicos (tienen su propio interruptor). */
export type SharingPolicyUpdate = Omit<SharingPolicy, 'allowPublicShareLinks'>;

/** `GET /storage/settings/portal-uploads`: lo que vende el plan y lo que la oficina restringe al portal. */
export interface PortalUploadSettings {
  planFileTypeGroups: string[];
  planMaxFileBytes: number;
  /** null = los mismos grupos del plan. */
  portalFileTypeGroups: string[] | null;
  /** null = el tamaño de la carpeta/plan. */
  portalMaxFileBytes: number | null;
}

export interface PortalUploadSettingsUpdate {
  fileTypeGroups: string[] | null;
  maxFileBytes: number | null;
}

/** Ajustes de almacenamiento de la oficina (CloudStorage.Api, perm `cloudstorage.settings.manage`). */
@Injectable({ providedIn: 'root' })
export class StorageSettingsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/storage/settings');
  }

  getSharing(): Observable<SharingPolicy> {
    return this.http.get<SharingPolicy>(`${this.base}/sharing`);
  }

  updateSharing(body: SharingPolicyUpdate): Observable<SharingPolicy> {
    return this.http.put<SharingPolicy>(`${this.base}/sharing`, body);
  }

  getPortalUploads(): Observable<PortalUploadSettings> {
    return this.http.get<PortalUploadSettings>(`${this.base}/portal-uploads`);
  }

  updatePortalUploads(body: PortalUploadSettingsUpdate): Observable<PortalUploadSettings> {
    return this.http.put<PortalUploadSettings>(`${this.base}/portal-uploads`, body);
  }
}
