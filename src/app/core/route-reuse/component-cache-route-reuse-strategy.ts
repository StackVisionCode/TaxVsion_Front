import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy } from '@angular/router';

/** Tope de páginas cacheadas simultáneamente (evita crecer sin límite en sesiones largas). */
const MAX_CACHE_SIZE = 20;

/** Claves que nunca se cachean — siempre deben arrancar limpias. */
const EXCLUDED_KEYS = new Set(['login']);

/**
 * Mantiene vivas las instancias de componentes de página al navegar entre
 * rutas: en vez del comportamiento por defecto de Angular (destruir y
 * recrear el componente en cada visita, reseteando toda su data mock a la
 * semilla original), esta estrategia "despega" el componente al salir y lo
 * vuelve a "pegar" tal cual estaba al regresar.
 *
 * La clave de caché es la URL resuelta completa (segmentos concretos, no
 * solo `routeConfig.path`): cada feature define su página como
 * `{ path: '', loadComponent: ... }` dentro de su propio archivo de rutas
 * lazy, así que TODAS tienen `routeConfig.path === ''` — usar solo ese path
 * haría que todas las páginas compartan una única entrada de caché (bug ya
 * encontrado: cualquier navegación reataba siempre la primera página
 * visitada). La URL completa (`dashboard`, `invoices`, `clients/client-1`,
 * etc.) sí distingue cada página correctamente.
 *
 * `shouldReuseRoute` se deja EXACTAMENTE como el default de Angular
 * (`future.routeConfig === curr.routeConfig`) — no se toca, porque
 * endurecerlo con esta misma clave desestabiliza la reconciliación interna
 * del árbol de rutas (se probó y produjo un `Maximum call stack size
 * exceeded` en `setRouterState`, incluso entre rutas sin parámetros).
 */
export class ComponentCacheRouteReuseStrategy implements RouteReuseStrategy {
  private readonly cache = new Map<string, DetachedRouteHandle>();

  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return this.isCacheable(route);
  }

  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    if (!this.isCacheable(route)) return;
    const key = this.buildKey(route);

    if (!handle) {
      this.cache.delete(key);
      return;
    }

    if (!this.cache.has(key) && this.cache.size >= MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, handle);
  }

  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    return this.isCacheable(route) && this.cache.has(this.buildKey(route));
  }

  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    if (!this.isCacheable(route)) return null;
    return this.cache.get(this.buildKey(route)) ?? null;
  }

  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    return future.routeConfig === curr.routeConfig;
  }

  private isCacheable(route: ActivatedRouteSnapshot): boolean {
    return !!route.routeConfig && !EXCLUDED_KEYS.has(this.buildKey(route));
  }

  /** URL completa resuelta (con valores concretos de parámetros), como clave única por página. */
  private buildKey(route: ActivatedRouteSnapshot): string {
    const segments = route.pathFromRoot.flatMap(snapshot => snapshot.url.map(segment => segment.path));
    return segments.join('/');
  }
}
