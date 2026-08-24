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
  /**
   * El HOST manda sobre lo guardado: si la app se sirve desde
   * `https://<slug>.taxproffice.com`, ese subdominio ES el tenant, y usar el
   * `tenant_slug` de una sesión anterior mandaría las requests a otra oficina.
   * Sin subdominio de tenant (p. ej. `app.taxproffice.com`) se cae a lo guardado.
   */
  private readonly _slug = signal<string | null>(tenantSlugFromHost() ?? readStoredSlug());
  /** Slug del tenant actual (o null si aún no se resolvió). Reactivo. */
  readonly slug = this._slug.asReadonly();

  /** Fija el slug del tenant (tras resolverlo por email/campo/login) y lo persiste. */
  setSlug(slug: string): void {
    const normalized = slug.trim().toLowerCase();
    this._slug.set(normalized);
    localStorage.setItem(SLUG_STORAGE_KEY, normalized);
  }

  /**
   * Limpia el slug recordado (logout / cambio de oficina). NO deja el servicio sin
   * tenant: si la app se sirve desde el subdominio de una oficina, ese host sigue
   * siendo la identidad válida. Solo se olvida lo que quedó de la sesión anterior,
   * para que el siguiente usuario del navegador no herede otra oficina.
   */
  clearSlug(): void {
    localStorage.removeItem(SLUG_STORAGE_KEY);
    this._slug.set(tenantSlugFromHost());
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

    let parsed: URL;
    try {
      parsed = new URL(url, window.location.origin);
    } catch {
      return false;
    }

    const host = parsed.hostname.toLowerCase();
    const isOurs = host === environment.baseDomain || host.endsWith(`.${environment.baseDomain}`);
    if (!isOurs) {
      return false;
    }

    // Las URLs presignadas de almacenamiento (MinIO/S3) se publican en NUESTRO dominio,
    // pero no son la API: ya llevan su propia firma en la query. Añadirles un
    // `Authorization` fuerza un preflight CORS en lo que era un POST simple, el
    // almacenamiento puede rechazarlas por doble autenticación, y de paso mandaría el
    // JWT del tenant a un origen que solo debe ver el objeto firmado.
    if (isPresignedStorageUrl(parsed)) {
      return false;
    }

    return true;
  }
}

function readStoredSlug(): string | null {
  try {
    return localStorage.getItem(SLUG_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Subdominios que NO son oficinas: tomarlos como slug mandaría las llamadas a un
 * tenant inexistente en vez de usar el que ya estuviera resuelto.
 *  - `api`  → host de sistema (`environment.systemHost`).
 *  - `app`  → portal genérico desde el que se busca la oficina por email
 *             (ver find-office-page).
 *  - `www` / `admin` → nunca sirven la app de un tenant.
 */
const NON_TENANT_SUBDOMAINS = new Set(['api', 'app', 'www', 'admin']);

/** Buckets de MinIO expuestos en el mismo dominio que la API (ver deploy/docker). */
const STORAGE_BUCKET_PREFIXES = ['/taxvision-storage/', '/taxvision-temp/', '/taxvision-quarantine/'];

/**
 * ¿Es una URL presignada de almacenamiento? Se mira la firma en la query (la llevan
 * todas las presignadas de S3/MinIO, cambien o no los nombres de bucket) y, como
 * respaldo, el prefijo de bucket.
 */
function isPresignedStorageUrl(parsed: URL): boolean {
  if (parsed.searchParams.has('X-Amz-Signature') || parsed.searchParams.has('X-Amz-Credential')) {
    return true;
  }
  return STORAGE_BUCKET_PREFIXES.some(prefix => parsed.pathname.startsWith(prefix));
}

/**
 * `<slug>.taxproffice.com` → `slug`; null si el host no identifica a un tenant.
 *
 * Sin esto, entrar directo al subdominio de la oficina (lo natural: un marcador,
 * o teclear la URL) dejaba la app sin slug hasta que alguien pasara `?office=`,
 * y la primera llamada de tenant reventaba con la excepción de `tenantBase()`
 * — el dato estaba en la barra de direcciones todo el tiempo.
 */
export function tenantSlugFromHost(): string | null {
  if (!environment.production) {
    // En dev un único gateway atiende todo y el host es localhost: no hay subdominio que leer.
    return null;
  }
  try {
    const host = window.location.hostname.toLowerCase();
    const suffix = `.${environment.baseDomain}`;
    if (!host.endsWith(suffix)) {
      return null;
    }
    if (host === environment.systemHost.split(':')[0].toLowerCase()) {
      return null;
    }
    const slug = host.slice(0, -suffix.length);
    if (!slug || slug.includes('.') || NON_TENANT_SUBDOMAINS.has(slug)) {
      return null;
    }
    return slug;
  } catch {
    // Sin DOM (SSR / tests): no hay host del que deducir nada.
    return null;
  }
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}
