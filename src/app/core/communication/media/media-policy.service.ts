import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { SETTINGS_CHANGED_EVENT, SettingsChangedEvent } from '@core/realtime/realtime.model';
import { MediaPolicyDto, MediaPreferencesPatch, isMediaPolicyDto } from './media-policy.model';

/**
 * F4 — Fuente única de la política de media del cliente. Caché por sesión en un signal; se carga
 * la primera vez que alguien la necesita (`ensureLoaded`) y se refresca al recibir `settings.changed`
 * por el socket y tras guardar preferencias (`PUT /communication/preferences`).
 *
 * Mientras no cargó, `policy()` es null: los consumidores esperan `await ensureLoaded()` — nunca
 * inventan números. Uso: `const policy = await this.mediaPolicy.ensureLoaded();`.
 */
@Injectable({ providedIn: 'root' })
export class MediaPolicyService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private readonly realtime = inject(CommunicationRealtimeService);

  /** Última política cargada (null hasta la primera carga). */
  readonly policy = signal<MediaPolicyDto | null>(null);
  private inflight: Promise<MediaPolicyDto> | null = null;
  /** F6 — la política vino del contexto público de invitado: no hay JWT para re-pedirla. */
  private primedExternally = false;

  constructor() {
    // Cambió la configuración (plataforma/oficina/usuario): si ya la teníamos, se vuelve a pedir.
    // (Si nadie la cargó todavía no hay nada que refrescar; el invitado no puede pedirla.)
    this.realtime.on<SettingsChangedEvent>(SETTINGS_CHANGED_EVENT).subscribe(() => {
      if (this.policy() && !this.primedExternally) {
        void this.refresh().catch(() => undefined);
      }
    });
  }

  /**
   * F6 (D-47) — fija la política que trae `POST /meetings/guest/context` (el invitado no tiene JWT
   * para `GET /communication/media-policy`). A partir de aquí `ensureLoaded` la devuelve sin red y
   * `settings.changed` no intenta refrescarla.
   */
  prime(dto: MediaPolicyDto): void {
    this.primedExternally = true;
    this.policy.set(dto);
  }

  /** Deshace `prime` (al salir de la página pública): el próximo `ensureLoaded` con sesión vuelve a pedirla. */
  unprime(): void {
    if (this.primedExternally) {
      this.primedExternally = false;
      this.policy.set(null);
    }
  }

  /** Devuelve la política cacheada o la carga (una sola petición aunque la pidan varios a la vez). */
  ensureLoaded(): Promise<MediaPolicyDto> {
    const current = this.policy();
    if (current) {
      return Promise.resolve(current);
    }
    return this.refresh();
  }

  /** Fuerza una recarga (comparte la petición en vuelo si ya hay una). */
  refresh(): Promise<MediaPolicyDto> {
    if (!this.inflight) {
      this.inflight = this.load().finally(() => (this.inflight = null));
    }
    return this.inflight;
  }

  /** Guarda preferencias del usuario (patch parcial) y refresca la política efectiva. */
  async updatePreferences(patch: MediaPreferencesPatch): Promise<MediaPolicyDto> {
    await firstValueFrom(this.http.put(this.api.tenantUrl('/communication/preferences'), patch));
    return this.refresh();
  }

  private async load(): Promise<MediaPolicyDto> {
    const dto = await firstValueFrom(this.http.get<unknown>(this.api.tenantUrl('/communication/media-policy')));
    if (!isMediaPolicyDto(dto)) {
      throw new Error('MediaPolicy: unexpected response shape');
    }
    this.policy.set(dto);
    return dto;
  }
}
