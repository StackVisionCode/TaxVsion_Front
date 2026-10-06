import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { AccessStore } from '@core/access/access.store';
import { ApiConfigService } from '@core/config/api-config.service';

/** Moneda a la que se cae cuando la oficina no configuró otra (o no se puede leer). */
export const FALLBACK_OFFICE_CURRENCY = 'USD';

/** Permission que ya habilita leer el perfil del emisor. Solo se LEE: no cambia ningún gate. */
const ISSUER_PROFILE_PERMISSION = 'invoicing.view';

/**
 * Moneda por defecto de la oficina (la que se configura en Billing → Company, `defaultCurrency` del
 * perfil del emisor). Root singleton para que features que no pueden importar billing
 * (products-services, inventory) dejen de asumir USD.
 *
 * API:
 *  - `currency()` ........ signal con el código ISO (siempre algo válido; 'USD' mientras no se sepa).
 *  - `set(code)` ......... lo llama billing.store cuando carga o guarda el perfil del emisor.
 *  - `ensureLoaded()` .... pide `GET /billing/issuer-profile` una sola vez, y SOLO si el usuario ya
 *                          tiene `invoicing.view`; si no, se queda en el fallback sin pegarle al API.
 *
 * Ejemplo:
 *   private readonly officeCurrency = inject(OfficeCurrencyStore);
 *   constructor() { void this.officeCurrency.ensureLoaded(); }
 *   priceCurrency: this.officeCurrency.currency()
 *
 * Los ítems/facturas existentes conservan su propia moneda: esto solo decide la de los NUEVOS.
 */
@Injectable({ providedIn: 'root' })
export class OfficeCurrencyStore {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private readonly access = inject(AccessStore);

  private readonly _currency = signal(FALLBACK_OFFICE_CURRENCY);
  readonly currency = this._currency.asReadonly();

  /** Ya se sabe la moneda real (llegó de billing o del GET); no se vuelve a pedir. */
  private known = false;
  private inFlight: Promise<void> | null = null;

  set(code: string | null | undefined): void {
    const normalized = normalizeCurrency(code);
    if (!normalized) {
      return;
    }
    this._currency.set(normalized);
    this.known = true;
  }

  ensureLoaded(): Promise<void> {
    if (this.known) {
      return Promise.resolve();
    }
    this.inFlight ??= this.fetch().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetch(): Promise<void> {
    try {
      // Con el bootstrap de acceso todavía viajando, `can` respondería false por falta de datos.
      await this.access.ready();
    } catch {
      return;
    }
    if (this.known || !this.access.can(ISSUER_PROFILE_PERMISSION)) {
      return;
    }
    // `tenantBase()` lanza si todavía no hay slug resuelto: se trata como "sin perfil".
    await new Promise<void>(resolve => {
      let base: string;
      try {
        base = this.api.tenantBase();
      } catch {
        resolve();
        return;
      }
      this.http
        .get<{ defaultCurrency?: string | null }>(`${base}/billing/issuer-profile`)
        .subscribe({
          next: profile => {
            // Si billing ya empujó un valor mientras el GET viajaba, ese manda.
            if (!this.known) {
              this.set(profile?.defaultCurrency);
            }
            this.known = true;
            resolve();
          },
          // Silencioso: sin perfil se queda el fallback, y se reintenta en la próxima llamada.
          error: () => resolve(),
        });
    });
  }
}

/** Código ISO de 3 letras en mayúsculas, o null si no sirve. */
function normalizeCurrency(code: string | null | undefined): string | null {
  const trimmed = (code ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : null;
}
