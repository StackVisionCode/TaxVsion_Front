import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { EMPTY, Observable, catchError, defer, switchMap } from 'rxjs';

/** Separación entre ARRANQUES de precarga: deja hueco a las peticiones de la página activa. */
const GAP_MS = 150;
/** Retraso extra de las secciones marcadas `preloadPriority: 'low'`. */
const LOW_PRIORITY_DELAY_MS = 4_000;
/** Techo del requestIdleCallback: si el hilo nunca está ocioso, se precarga igual. */
const IDLE_TIMEOUT_MS = 1_500;

/**
 * Preloading pausado, opt-out.
 *
 * `PreloadAllModules` dispara TODOS los chunks a la vez en el primer NavigationEnd —
 * cientos de KB en ~120 archivos — justo cuando el dashboard está lanzando sus propias
 * llamadas a la API, y arrastra lo más caro (signature+pdf.js, meetings+mediasoup) que
 * la mayoría de los usuarios no abre nunca. Esta estrategia hace lo mismo pero espaciado
 * en el tiempo y en ratos ociosos, y permite excluir secciones con
 * `data: { preload: false }` o posponerlas con `data: { preloadPriority: 'low' }`.
 *
 * Es opt-OUT y no opt-in a propósito: el RouterPreloader recursa y vuelve a llamar
 * `preload()` para el hijo `{ path: '', loadComponent }` que vive dentro del
 * `*.routes.ts` de cada feature, y ese hijo no tiene `data`. Con opt-in habría que
 * editar los 30 ficheros de rutas para marcar cada hijo; con opt-out la configuración
 * queda toda en `app.routes.ts` y se precargan los DOS niveles de carga, que es
 * justamente donde está la latencia que se quiere matar.
 *
 * IMPORTANTE — el espaciado es por hora de ARRANQUE, nunca de finalización: ese
 * `preload()` del hijo ocurre DENTRO del `load()` del padre (ver `preloadConfig` en el
 * router), así que una cola que esperase a que el anterior terminara dejaría al hijo
 * encolado detrás de su propio padre y ninguno de los dos completaría jamás.
 */
@Injectable({ providedIn: 'root' })
export class PacedPreloadStrategy implements PreloadingStrategy {
  /** Momento (performance.now) en el que puede arrancar la próxima precarga. */
  private nextSlotAt = 0;

  /**
   * `load` capturados de las rutas excluidas, para poder dispararlas a demanda desde el
   * hover del sidebar. Se re-registran en cada NavigationEnd (el preloader reprocesa la
   * config completa) hasta que la ruta se carga de verdad.
   */
  private readonly onDemand = new Map<string, () => Observable<unknown>>();
  private readonly fired = new Set<string>();

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (route.data?.['preload'] === false) {
      // No se precarga sola, pero se guarda el loader DEL ROUTER para poder dispararla en
      // hover sin repetir en otro sitio la ruta del import() (una sola fuente de verdad).
      if (route.path) {
        this.onDemand.set(route.path, load);
      }
      return EMPTY;
    }
    if (isDataSaver()) {
      return EMPTY;
    }

    const now = performance.now();
    const base = route.data?.['preloadPriority'] === 'low' ? now + LOW_PRIORITY_DELAY_MS : now;
    const startAt = Math.max(base, this.nextSlotAt);
    this.nextSlotAt = startAt + GAP_MS;

    return defer(() => waitUntil(startAt - performance.now())).pipe(
      switchMap(() => load()),
      // Una precarga fallida es irrelevante: el Router reintentará el import() cuando el
      // usuario navegue de verdad. Tragarla evita ruido en consola por, p. ej., un deploy
      // nuevo que invalidó los hashes de los chunks.
      catchError(() => EMPTY),
    );
  }

  /**
   * Dispara la precarga de una ruta excluida (hover/focus en el sidebar). Idempotente y
   * silenciosa: si la ruta no está registrada o ya se disparó, no hace nada.
   */
  prefetchPath(path: string): void {
    const key = path.replace(/^\//, '');
    const load = this.onDemand.get(key);
    if (!load || this.fired.has(key)) {
      return;
    }
    this.fired.add(key);
    load()
      .pipe(catchError(() => EMPTY))
      .subscribe({ error: () => {} });
  }
}

/** Conexión lenta o ahorro de datos: no gastamos el plan del usuario en adivinar. */
function isDataSaver(): boolean {
  const conn = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection;
  return conn?.saveData === true || conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g';
}

function waitUntil(delayMs: number): Promise<void> {
  return new Promise<void>(resolve => {
    const onIdle = () => {
      const ric = (
        globalThis as {
          requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
        }
      ).requestIdleCallback;
      if (typeof ric === 'function') {
        ric(() => resolve(), { timeout: IDLE_TIMEOUT_MS });
      } else {
        // Safari viejo no tiene requestIdleCallback; el espaciado temporal ya basta.
        resolve();
      }
    };
    if (delayMs > 0) {
      setTimeout(onIdle, delayMs);
    } else {
      onIdle();
    }
  });
}
