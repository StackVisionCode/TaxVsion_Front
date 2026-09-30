import { HttpClient } from '@angular/common/http';
import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { AccessStore } from '@core/access/access.store';
import { ApiConfigService } from '@core/config/api-config.service';

/**
 * Último recurso cuando la oficina todavía no tiene moneda configurada (o el usuario no puede leer el
 * perfil del emisor). Es el ÚNICO lugar del front donde vive este literal para altas nuevas.
 */
export const FALLBACK_CURRENCY = 'USD';

/** Normaliza un código ISO-4217 ("usd " → "USD"); null si no parece un código válido. */
export function normalizeCurrency(value: string | null | undefined): string | null {
  const code = (value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/**
 * Moneda por defecto de la oficina (item 6.1). La fuente de verdad es `defaultCurrency` del perfil del
 * emisor (`GET /billing/issuer-profile`), que es un dato de Billing; pero la necesitan también
 * Products & Services e Inventory para las altas, y las features no se importan entre sí — por eso vive
 * acá, en `core`, como una señal compartida.
 *
 * - Billing la EMPUJA con {@link set} al cargar/guardar su perfil (evita una segunda petición).
 * - El resto la PIDE con {@link ensureLoaded}: lee el perfil solo si el usuario tiene `invoicing.view`
 *   (sin él el endpoint responde 403 y no hay nada que mostrar); si no, queda el fallback.
 *
 * El histórico no se toca: cada factura/ítem existente conserva su propia moneda.
 */
@Injectable({ providedIn: 'root' })
export class OfficeCurrencyStore {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private readonly access = inject(AccessStore);

  private readonly _configured = signal<string | null>(null);
  private loading = false;

  /** Moneda a usar en altas nuevas: la configurada o, en su defecto, {@link FALLBACK_CURRENCY}. */
  readonly currency: Signal<string> = computed(() => this._configured() ?? FALLBACK_CURRENCY);

  /** true cuando la moneda viene del perfil real y no del fallback. */
  readonly isConfigured: Signal<boolean> = computed(() => this._configured() !== null);

  /** Billing informa la moneda del perfil que ya leyó o acaba de guardar. */
  set(currency: string | null | undefined): void {
    const code = normalizeCurrency(currency);
    if (code) {
      this._configured.set(code);
    }
  }

  /** Lee el perfil del emisor una sola vez (idempotente). Falla en silencio: queda el fallback. */
  ensureLoaded(): void {
    if (this._configured() !== null || this.loading || !this.access.can('invoicing.view')) {
      return;
    }
    this.loading = true;
    this.http.get<{ defaultCurrency?: string | null }>(`${this.api.tenantBase()}/billing/issuer-profile`).subscribe({
      next: profile => {
        this.loading = false;
        this.set(profile?.defaultCurrency);
      },
      error: () => {
        this.loading = false;
      },
    });
  }
}
