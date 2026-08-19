import { Injectable, signal } from '@angular/core';
import { environment } from '@env/environment';

const SLUG_STORAGE_KEY = 'tenant_slug';

/**
 * Fuente única de la URL base de la API. En multitenancy cada tenant vive en
 * https://<slug>.taxproffice.com y el backend resuelve el tenant por el Host, así que
 * la base NO puede ser un valor fijo: se calcula desde el slug resuelto.
 *
 * - {@link systemUrl}: endpoints del SISTEMA, sin tenant (signup, check-availability,
 *   tenant-resolution, JWKS). Van a systemHost (api.taxproffice.com).
 * - {@link tenantUrl}: login + todo lo del tenant. Van a https://<slug>.baseDomain.
 *
 * En dev (production=false) ambos caen a environment.apiUrl (el gateway local), porque
 * el backend corre con EnforceHostResolution=false y un solo host atiende todo.
 */
@Injectable({ providedIn: 'root' })
export class ApiConfigService {
  private readonly _slug = signal<string | null>(readStoredSlug());
  /** Slug del tenant actual (o null si aún no se resolvió). Reactivo. */
  readonly slug = this._slug.asReadonly();

  /** Fija el slug del tenant (tras resolverlo por email/campo/login) y lo persiste. */
  setSlug(slug: string): void {
    const normalized = slug.trim().toLowerCase();
    this._slug.set(normalized);
    localStorage.setItem(SLUG_STORAGE_KEY, normalized);
  }

  /** Limpia el slug (logout / cambio de oficina). */
  clearSlug(): void {
    this._slug.set(null);
    localStorage.removeItem(SLUG_STORAGE_KEY);
  }

  /** Base para endpoints del sistema (sin tenant). */
  systemBase(): string {
    return environment.production ? `https://${environment.systemHost}` : environment.apiUrl;
  }

  /** Base para endpoints del tenant. Lanza si en prod todavía no hay slug resuelto. */
  tenantBase(): string {
    if (!environment.production) {
      return environment.apiUrl;
    }
    const slug = this._slug();
    if (!slug) {
      throw new Error(
        'ApiConfigService: no hay tenant (slug) resuelto todavía. Resolvé el slug (email/campo/login) antes de una llamada de tenant.',
      );
    }
    return `https://${slug}.${environment.baseDomain}`;
  }

  /** URL absoluta de un endpoint del sistema. */
  systemUrl(path: string): string {
    return `${this.systemBase()}${normalizePath(path)}`;
  }

  /** URL absoluta de un endpoint del tenant. */
  tenantUrl(path: string): string {
    return `${this.tenantBase()}${normalizePath(path)}`;
  }

  /** true si la URL pertenece a alguno de nuestros hosts (para el interceptor de auth). */
  isApiUrl(url: string): boolean {
    if (!environment.production) {
      return !environment.apiUrl || url.startsWith(environment.apiUrl);
    }
    return url.includes(environment.baseDomain);
  }
}

function readStoredSlug(): string | null {
  try {
    return localStorage.getItem(SLUG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}
