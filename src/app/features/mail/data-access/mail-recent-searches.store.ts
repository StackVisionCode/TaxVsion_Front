import { Injectable, Signal, computed, inject, linkedSignal } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';

const KEY_PREFIX = 'crm.mailRecentSearches';
export const MAIL_RECENT_SEARCHES_MAX = 10;
const MAX_LENGTH = 400;

/**
 * Búsquedas recientes de Mail (D-3: en el navegador). Cada una es el texto canónico con operadores
 * (`from:ana@x.com factura`) para volver a ejecutarla tal cual. Por oficina y usuario (mismo patrón que
 * los clientes recientes de `CustomerDirectoryStore`); con localStorage bloqueado vive solo en memoria.
 */
@Injectable({ providedIn: 'root' })
export class MailRecentSearchesStore {
  private readonly auth = inject(AuthService);

  /** `tenantId.userId` de la sesión; null sin sesión. */
  private readonly scope = computed(() => {
    const user = this.auth.currentUser();
    return user?.tenant?.id && user.id ? `${user.tenant.id}.${user.id}` : null;
  });

  private readonly _recent = linkedSignal<string | null, string[]>({
    source: this.scope,
    computation: scope => this.load(scope),
  });
  readonly recent: Signal<string[]> = computed(() => this._recent());

  /** Sube una búsqueda al tope (sin duplicar, sin distinguir mayúsculas) y persiste. */
  add(query: string): void {
    const clean = (query ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
    if (!clean) {
      return;
    }
    const key = clean.toLowerCase();
    this.save(
      [clean, ...this._recent().filter(item => item.toLowerCase() !== key)].slice(0, MAIL_RECENT_SEARCHES_MAX),
    );
  }

  remove(query: string): void {
    this.save(this._recent().filter(item => item !== query));
  }

  clear(): void {
    this.save([]);
  }

  private save(next: string[]): void {
    this._recent.set(next);
    const scope = this.scope();
    if (!scope) {
      return;
    }
    try {
      if (next.length === 0) {
        localStorage.removeItem(this.key(scope));
      } else {
        localStorage.setItem(this.key(scope), JSON.stringify(next));
      }
    } catch {
      // storage bloqueado / modo privado: recientes es solo conveniencia.
    }
  }

  private key(scope: string): string {
    return `${KEY_PREFIX}.${scope}`;
  }

  private load(scope: string | null): string[] {
    if (!scope) {
      return [];
    }
    try {
      const raw = localStorage.getItem(this.key(scope));
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '').slice(0, MAIL_RECENT_SEARCHES_MAX)
        : [];
    } catch {
      return [];
    }
  }
}
