import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { CommunicationSettingsOverview, CommunicationSettingsPatch } from './communication-settings.model';

/** F9 — `GET/PUT /communication/settings` (gateado por `communication.settings.manage` en el backend). */
@Injectable({ providedIn: 'root' })
export class CommunicationSettingsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  get(): Observable<CommunicationSettingsOverview> {
    return this.http.get<CommunicationSettingsOverview>(this.api.tenantUrl('/communication/settings'));
  }

  /** PATCH parcial con semántica de PUT: solo viajan las claves cambiadas; responde la vista completa. */
  update(patch: CommunicationSettingsPatch): Observable<CommunicationSettingsOverview> {
    return this.http.put<CommunicationSettingsOverview>(this.api.tenantUrl('/communication/settings'), patch);
  }
}
