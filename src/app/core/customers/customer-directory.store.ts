import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, finalize, map, shareReplay, tap } from 'rxjs/operators';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { CustomerDirectoryService } from './customer-directory.service';
import { CustomerSearchParams, CustomerSummary, PagedResult } from './customer-summary.model';

/** Evento realtime que emite Communication al aplicar un `customer.*.v1` (F4). */
interface CustomerChangedEvent {
  customerId: string;
  changeType: string;
}

/**
 * Punto común de acceso al directorio de clientes (backlog 5.1). Deduplica y comparte las consultas
 * a `/customers` entre módulos: cache multi-query con TTL + dedup de peticiones en vuelo, resolución
 * de nombres por id (byId, alimentado por las búsquedas) y recientes. NO carga todo el directorio en
 * memoria: la búsqueda es server-side. `invalidate()`/`evict()` mantienen la frescura (F4 realtime).
 *
 * Aislamiento de tenant: cada tenant vive en su propio subdominio (origen), así que el cache es
 * naturalmente por-tenant; no hace falta el tenantId en la clave.
 */

const SEARCH_TTL_MS = 60_000;
const BYID_TTL_MS = 300_000;
const RECENTS_KEY = 'crm.recentCustomers';
const RECENTS_MAX = 8;

interface CacheEntry<T> {
  value?: T;
  loadedAt: number;
  inFlight?: Observable<T>;
}

@Injectable({ providedIn: 'root' })
export class CustomerDirectoryStore {
  private readonly service = inject(CustomerDirectoryService);
  private readonly realtime = inject(CommunicationRealtimeService);

  private readonly searchCache = new Map<string, CacheEntry<PagedResult<CustomerSummary>>>();
  private readonly byIdCache = new Map<string, CacheEntry<CustomerSummary>>();

  private readonly _recent = signal<CustomerSummary[]>(this.loadRecent());
  /** Clientes elegidos recientemente (localStorage), para pickers sin teclear. */
  readonly recent: Signal<CustomerSummary[]> = computed(() => this._recent());

  constructor() {
    // F4 — invalidación en tiempo real: Communication emite `customer.changed` al aplicar un
    // customer.*.v1; desalojamos ese cliente (y las búsquedas) para revalidar al próximo uso.
    // Singleton root: la suscripción vive con la app, no hace falta desuscribir.
    this.realtime.on<CustomerChangedEvent>('customer.changed').subscribe(evt => {
      if (evt?.customerId) {
        this.evict(evt.customerId);
      } else {
        this.invalidate();
      }
    });
    // Tras reconectar el socket pudimos perder eventos: se descarta todo el cache por las dudas.
    this.realtime.reconnected$.subscribe(() => this.invalidate());
  }

  /** Búsqueda server-side cacheada: misma clave dentro del TTL no vuelve a la red; peticiones en vuelo se comparten. */
  search(params: CustomerSearchParams): Observable<PagedResult<CustomerSummary>> {
    const key = this.searchKey(params);
    const entry = this.searchCache.get(key);
    if (entry?.inFlight) {
      return entry.inFlight;
    }
    if (entry?.value && Date.now() - entry.loadedAt < SEARCH_TTL_MS) {
      return of(entry.value);
    }

    const req$ = this.service.search(params).pipe(
      tap(page => {
        this.searchCache.set(key, { value: page, loadedAt: Date.now() });
        page.items.forEach(c => this.byIdCache.set(c.id, { value: c, loadedAt: Date.now() }));
      }),
      catchError(err => {
        this.searchCache.delete(key); // un fallo no queda "fresco": la próxima reintenta
        throw err;
      }),
      finalize(() => {
        const e = this.searchCache.get(key);
        if (e?.inFlight === req$ && e.value === undefined) {
          this.searchCache.delete(key); // limpia un in-flight cancelado sin resultado
        }
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.searchCache.set(key, { loadedAt: 0, inFlight: req$ });
    return req$;
  }

  /**
   * Resuelve nombres por id (tarjetas, listados). Sirve desde el cache poblado por `search`; los
   * faltantes se piden individualmente (cacheados). Un id inexistente se omite del resultado.
   */
  byId(ids: readonly string[]): Observable<Map<string, CustomerSummary>> {
    const result = new Map<string, CustomerSummary>();
    const misses: string[] = [];
    const now = Date.now();
    for (const id of new Set(ids)) {
      if (!id) {
        continue;
      }
      const entry = this.byIdCache.get(id);
      if (entry?.value && now - entry.loadedAt < BYID_TTL_MS) {
        result.set(id, entry.value);
      } else {
        misses.push(id);
      }
    }
    if (misses.length === 0) {
      return of(result);
    }
    return forkJoin(misses.map(id => this.fetchOne(id))).pipe(
      map(fetched => {
        fetched.forEach(c => {
          if (c) {
            result.set(c.id, c);
          }
        });
        return result;
      }),
    );
  }

  /** Sube un cliente al tope de recientes (dedup por id, cap RECENTS_MAX) y persiste. */
  addRecent(customer: CustomerSummary): void {
    const next = [customer, ...this._recent().filter(c => c.id !== customer.id)].slice(0, RECENTS_MAX);
    this._recent.set(next);
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
      // storage bloqueado / modo privado: recientes es solo conveniencia.
    }
  }

  /** Descarta todo el cache de búsquedas y de byId (tras una mutación en Clients, o al cerrar sesión). */
  invalidate(): void {
    this.searchCache.clear();
    this.byIdCache.clear();
  }

  /** Desaloja un cliente concreto de todos lados (invalidación puntual, p. ej. evento realtime en F4). */
  evict(customerId: string): void {
    this.byIdCache.delete(customerId);
    this.searchCache.clear(); // cualquier página pudo contenerlo
  }

  private fetchOne(id: string): Observable<CustomerSummary | null> {
    return this.service.getById(id).pipe(
      tap(c => this.byIdCache.set(id, { value: c, loadedAt: Date.now() })),
      catchError(() => of(null)), // un id no resoluble no rompe el lote
    );
  }

  private searchKey(p: CustomerSearchParams): string {
    return `${p.status ?? ''}|${(p.term ?? '').trim().toLowerCase()}|${p.page ?? 1}|${p.size ?? ''}`;
  }

  private loadRecent(): CustomerSummary[] {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      const parsed = raw ? (JSON.parse(raw) as CustomerSummary[]) : [];
      return Array.isArray(parsed) ? parsed.filter(c => c?.id && c.displayName) : [];
    } catch {
      return [];
    }
  }
}
