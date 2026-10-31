import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { MeetingSoundsPolicy } from './communication-settings.model';

/** F9 — preferencias de Communication del usuario (autoservicio; el backend usa el UserId del JWT). */
export interface CommunicationPreferences {
  meetingSoundsMuted: boolean;
  /** null = el idioma de la oficina. */
  transcriptLanguage: string | null;
  preferAudioOnly: boolean;
  /** null = el default de la oficina. */
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
  joinMuted: boolean;
  joinCameraOff: boolean;
  autoPictureInPicture: boolean;
}

export interface CommunicationPreferencesView {
  preferences: CommunicationPreferences;
  /** Lo que aplica hoy (preferencia ∪ oficina): idioma vigente y procesamiento de audio. */
  effective: { transcriptLanguage: string };
  soundsPolicy: MeetingSoundsPolicy;
}

@Injectable({ providedIn: 'root' })
export class CommunicationPreferencesService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  get(): Observable<CommunicationPreferencesView> {
    return this.http.get<CommunicationPreferencesView>(this.api.tenantUrl('/communication/preferences'));
  }
}
