import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  RecordingDetailsDto,
  RecordingScope,
  RecordingTranscriptDto,
  TranscriptSegment,
  parseTranscriptJson,
  parseTranscriptTxt,
} from './recording-playback.model';

/** Transcript ya parseado y de dónde salió. */
export interface LoadedTranscript {
  segments: TranscriptSegment[];
  source: 'json' | 'txt';
}

/**
 * F7 — Datos del reproductor de grabaciones (reuniones y llamadas), compartido por features/meetings y
 * features/clients. `getRecording` trae estado + URLs presignadas; `loadTranscript` baja el JSON v2
 * (o el TXT si falta/no se puede leer) con `fetch` SIN credenciales (URL presignada, como el visor).
 */
@Injectable({ providedIn: 'root' })
export class RecordingPlaybackService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  getRecording(scope: RecordingScope, id: string): Observable<RecordingDetailsDto> {
    const segment = scope === 'meeting' ? 'meetings' : 'calls';
    return this.http.get<RecordingDetailsDto>(this.api.tenantUrl(`/communication/${segment}/${encodeURIComponent(id)}/recording`));
  }

  /** null = el transcript no está listo o no se pudo leer ninguno de los dos archivos. */
  async loadTranscript(transcript: RecordingTranscriptDto | null): Promise<LoadedTranscript | null> {
    if (!transcript || transcript.state !== 'Ready') {
      return null;
    }
    if (transcript.json?.url) {
      try {
        const segments = parseTranscriptJson(JSON.parse(await this.fetchText(transcript.json.url)));
        if (segments) {
          return { segments, source: 'json' };
        }
      } catch {
        /* se cae al TXT */
      }
    }
    if (transcript.txt?.url) {
      try {
        return { segments: parseTranscriptTxt(await this.fetchText(transcript.txt.url)), source: 'txt' };
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Lectura de una URL presignada (sin cookies ni Authorization: el interceptor no debe tocarla). */
  protected async fetchText(url: string): Promise<string> {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) {
      throw new Error(`Transcript download failed (${response.status})`);
    }
    return response.text();
  }
}
