import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { ApiConfigService } from '@core/config/api-config.service';

/** Idiomas que la oficina puede elegir como predeterminado (`defaultLanguage` del perfil de Tenant). */
export type OfficeLanguage = 'en' | 'es';

/** Lo que se usa sin perfil, sin idioma válido o si no se puede leer. */
export const FALLBACK_OFFICE_LANGUAGE: OfficeLanguage = 'en';

/**
 * Idioma predeterminado de la oficina (`GET /tenants/current/profile`, lo lee cualquier usuario del
 * tenant). Vive en core porque una feature no importa de otra: clients no puede usar el servicio de
 * company-settings.
 *
 * API:
 *  - `language()` .. último valor conocido (fallback 'en' hasta que llegue uno), para preseleccionar ya.
 *  - `refresh()` ... vuelve a leer el perfil (una sola petición viva a la vez) y resuelve con el idioma
 *                    vigente; si falla, resuelve con el último conocido. Nunca rechaza.
 *
 * No cachea entre llamadas: se pide al abrir el alta, así un cambio en /company/settings se ve sin recargar.
 */
@Injectable({ providedIn: 'root' })
export class OfficeLanguageStore {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private readonly _language = signal<OfficeLanguage>(FALLBACK_OFFICE_LANGUAGE);
  readonly language = this._language.asReadonly();

  private inFlight: Promise<OfficeLanguage> | null = null;

  refresh(): Promise<OfficeLanguage> {
    this.inFlight ??= this.fetch().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private fetch(): Promise<OfficeLanguage> {
    return new Promise((resolve) => {
      let base: string;
      try {
        // Lanza si todavía no hay slug resuelto: se trata como "sin perfil".
        base = this.api.tenantBase();
      } catch {
        resolve(this._language());
        return;
      }
      this.http
        .get<{ defaultLanguage?: string | null }>(`${base}/tenants/current/profile`)
        .subscribe({
          next: (profile) => {
            this._language.set(normalizeOfficeLanguage(profile?.defaultLanguage));
            resolve(this._language());
          },
          error: () => resolve(this._language()),
        });
    });
  }
}

/** 'en' | 'es' sin importar mayúsculas; cualquier otra cosa (o null) = fallback. */
export function normalizeOfficeLanguage(value: string | null | undefined): OfficeLanguage {
  const code = (value ?? '').trim().toLowerCase();
  return code === 'es' || code === 'en' ? code : FALLBACK_OFFICE_LANGUAGE;
}
