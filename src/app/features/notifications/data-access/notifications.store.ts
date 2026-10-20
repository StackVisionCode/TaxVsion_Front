import { Injectable, inject, signal } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { AppNotification } from '../ui/notification-list/notification-list.component';
import {
  NotificationDto,
  NotificationReadConfirmed,
  NotificationsReadAllConfirmed,
  dtoToAppNotification,
} from './notifications.model';
import { NotificationsService } from './notifications.service';

const RECENT_SIZE = 8;
const DASHBOARD_SIZE = 6;
const PAGE_SIZE = 20;

@Injectable({ providedIn: 'root' })
export class NotificationsStore {
  private readonly service = inject(NotificationsService);
  private readonly realtime = inject(CommunicationRealtimeService);

  // Notification center state.
  private readonly _items = signal<AppNotification[]>([]);
  private readonly _loading = signal(false);
  private readonly _loadingMore = signal(false);
  private readonly _markingAll = signal(false);
  /** Guard de concurrencia para operaciones bulk (mark-many-*, delete-many). */
  private readonly _applyingBulk = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _unreadOnly = signal(false);
  private readonly _page = signal(1);
  private readonly _hasMore = signal(false);
  /** Total server-side bajo el filtro actual (`unreadOnly`); se usa para "Showing N of M". */
  private readonly _total = signal(0);

  // Bell state.
  private readonly _recent = signal<AppNotification[]>([]);
  private readonly _recentLoading = signal(false);
  private readonly _recentError = signal<string | null>(null);

  // Dashboard widget state.
  private readonly _dashboardItems = signal<AppNotification[]>([]);
  private readonly _dashboardLoading = signal(false);
  private readonly _dashboardError = signal<string | null>(null);

  private readonly _unreadCount = signal(0);
  private lastUnreadAsOfMs = Number.NEGATIVE_INFINITY;
  private lastRecentAsOfMs = Number.NEGATIVE_INFINITY;
  private lastDashboardAsOfMs = Number.NEGATIVE_INFINITY;
  private lastPageAsOfMs = Number.NEGATIVE_INFINITY;
  private realtimeWired = false;
  private visibilityWired = false;
  private pageInitialized = false;
  private dashboardInitialized = false;
  /**
   * `createdAtUtc` (ms) de la notificación más nueva vista en CUALQUIER feed
   * (recent / items / dashboard / incoming socket). Es el cursor del resync vía
   * `GET /notifications/since?sinceUtc=X`: tras una reconexión de socket, pide
   * exactamente lo que llegó durante el corte, sin recargar la primera página
   * entera. `-Infinity` = sin baseline todavía → caemos al resync "legacy"
   * (reload de recent/firstPage) para la primera carga.
   */
  private lastSeenCreatedAtMs = Number.NEGATIVE_INFINITY;
  /** Techo defensivo del batch de resync: si pasa de esto, caemos al reload completo. */
  private static readonly SINCE_BATCH_LIMIT = 50;

  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly markingAll = this._markingAll.asReadonly();
  readonly applyingBulk = this._applyingBulk.asReadonly();
  readonly error = this._error.asReadonly();
  readonly unreadCount = this._unreadCount.asReadonly();
  readonly unreadOnly = this._unreadOnly.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly total = this._total.asReadonly();
  readonly currentPage = this._page.asReadonly();
  /** Tamaño de página fijo del backend (expuesto para que la UI calcule total de páginas). */
  readonly pageSize = PAGE_SIZE;

  readonly recent = this._recent.asReadonly();
  readonly recentLoading = this._recentLoading.asReadonly();
  readonly recentError = this._recentError.asReadonly();

  readonly dashboardItems = this._dashboardItems.asReadonly();
  readonly dashboardLoading = this._dashboardLoading.asReadonly();
  readonly dashboardError = this._dashboardError.asReadonly();

  startRealtime(): void {
    if (!this.realtimeWired) {
      this.realtimeWired = true;
      this.realtime
        .on<NotificationDto>('notification.received')
        .subscribe((dto) => this.applyIncoming(dto));
      // notification.updated reemplaza la fila agrupada ("3 new emails") sin alterar su posición.
      this.realtime
        .on<NotificationDto>('notification.updated')
        .subscribe((dto) => this.applyUpdated(dto));
      this.realtime
        .on<{ count: number; asOfUtc: string }>('notification.unread_count.changed')
        .subscribe((dto) => this.applyUnreadCount(dto.count, dto.asOfUtc));
      this.realtime
        .on<NotificationReadConfirmed>('notification.read.confirmed')
        .subscribe((dto) => this.setReadLocally(dto.notificationId, true));
      this.realtime
        .on<NotificationsReadAllConfirmed>('notification.read_all.confirmed')
        .subscribe((dto) => this.applyReadAllLocally(dto.cutoffUtc));
      this.realtime.reconnected$.subscribe(() => this.resyncOnReconnect());
    }
    if (!this.visibilityWired && typeof document !== 'undefined') {
      this.visibilityWired = true;
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.loadRecent();
    this.refreshUnreadCount();
  }

  loadRecent(): void {
    this._recentLoading.set(true);
    this._recentError.set(null);
    this.service.list({ page: 1, size: RECENT_SIZE }).subscribe({
      next: (result) => {
        const asOfMs = this.parseVersion(result.asOfUtc);
        if (asOfMs >= this.lastRecentAsOfMs) {
          this.lastRecentAsOfMs = asOfMs;
          const items = result.items.map(dtoToAppNotification);
          this._recent.set(items);
          this.bumpLastSeenFromItems(items);
        }
        this.applyUnreadCount(result.unreadCount, result.asOfUtc);
        this._recentLoading.set(false);
      },
      error: (err) => {
        this._recentError.set(toApiError(err).message);
        this._recentLoading.set(false);
      },
    });
  }

  loadDashboard(): void {
    this.dashboardInitialized = true;
    this._dashboardLoading.set(true);
    this._dashboardError.set(null);
    this.service.list({ page: 1, size: DASHBOARD_SIZE }).subscribe({
      next: (result) => {
        const asOfMs = this.parseVersion(result.asOfUtc);
        if (asOfMs >= this.lastDashboardAsOfMs) {
          this.lastDashboardAsOfMs = asOfMs;
          const items = result.items.map(dtoToAppNotification);
          this._dashboardItems.set(items);
          this.bumpLastSeenFromItems(items);
        }
        this.applyUnreadCount(result.unreadCount, result.asOfUtc);
        this._dashboardLoading.set(false);
      },
      error: (err) => {
        this._dashboardError.set(toApiError(err).message);
        this._dashboardLoading.set(false);
      },
    });
  }

  loadFirstPage(): void {
    this.pageInitialized = true;
    this._loading.set(true);
    this._error.set(null);
    this.service
      .list({ page: 1, size: PAGE_SIZE, unreadOnly: this._unreadOnly() || undefined })
      .subscribe({
        next: (result) => {
          // Guard de secuencia: una respuesta mas vieja no pisa items/page frescos
          // (p.ej. toggle unreadOnly rapido dispara dos cargas y llegan desordenadas).
          const asOfMs = this.parseVersion(result.asOfUtc);
          if (asOfMs >= this.lastPageAsOfMs) {
            this.lastPageAsOfMs = asOfMs;
            const items = result.items.map(dtoToAppNotification);
            this._items.set(items);
            this.bumpLastSeenFromItems(items);
            this._page.set(result.page);
            this._total.set(result.total);
            // Preferimos `total` del servidor para hasMore cuando viene;
            // fallback al heurístico size-lleno por si vuelve a 0 (tenants nuevos).
            this._hasMore.set(
              result.total > 0
                ? result.items.length < result.total
                : result.items.length === result.size,
            );
          }
          this.applyUnreadCount(result.unreadCount, result.asOfUtc);
          this._loading.set(false);
        },
        error: (err) => {
          this._error.set(toApiError(err).message);
          this._loading.set(false);
        },
      });
  }

  loadMore(): void {
    if (this._loading() || this._loadingMore() || !this._hasMore()) {
      return;
    }
    this._loadingMore.set(true);
    this._error.set(null);
    const nextPage = this._page() + 1;
    this.service
      .list({ page: nextPage, size: PAGE_SIZE, unreadOnly: this._unreadOnly() || undefined })
      .subscribe({
        next: (result) => {
          const asOfMs = this.parseVersion(result.asOfUtc);
          // Si llego un loadFirstPage mas nuevo en paralelo, descartamos este append
          // para no mezclar paginas de dos estados distintos del servidor.
          if (asOfMs >= this.lastPageAsOfMs) {
            this.lastPageAsOfMs = asOfMs;
            this._items.update((list) => {
              const known = new Set(list.map((item) => item.id));
              return [
                ...list,
                ...result.items.map(dtoToAppNotification).filter((item) => !known.has(item.id)),
              ];
            });
            this._page.set(nextPage);
            this._total.set(result.total);
            this._hasMore.set(
              result.total > 0
                ? this._items().length < result.total
                : result.items.length === result.size,
            );
          }
          this.applyUnreadCount(result.unreadCount, result.asOfUtc);
          this._loadingMore.set(false);
        },
        error: (err) => {
          this._error.set(toApiError(err).message);
          this._loadingMore.set(false);
        },
      });
  }

  /** Navega a una página específica (reemplaza items, no hace append). Usado por paginación numérica. */
  goToPage(page: number): void {
    if (page < 1 || this._loading()) return;
    const requestedPage = Math.max(1, Math.floor(page));
    this._loading.set(true);
    this._error.set(null);
    this.service
      .list({ page: requestedPage, size: PAGE_SIZE, unreadOnly: this._unreadOnly() || undefined })
      .subscribe({
        next: (result) => {
          const asOfMs = this.parseVersion(result.asOfUtc);
          if (asOfMs >= this.lastPageAsOfMs) {
            this.lastPageAsOfMs = asOfMs;
            this._items.set(result.items.map(dtoToAppNotification));
            this._page.set(result.page);
            this._total.set(result.total);
            this._hasMore.set(
              result.total > 0
                ? result.page * result.size < result.total
                : result.items.length === result.size,
            );
          }
          this.applyUnreadCount(result.unreadCount, result.asOfUtc);
          this._loading.set(false);
        },
        error: (err) => {
          this._error.set(toApiError(err).message);
          this._loading.set(false);
        },
      });
  }

  setUnreadOnly(value: boolean): void {
    if (this._unreadOnly() === value) {
      return;
    }
    this._unreadOnly.set(value);
    this.loadFirstPage();
  }

  refreshUnreadCount(): void {
    this.service.unreadCount().subscribe({
      next: (result) => this.applyUnreadCount(result.count, result.asOfUtc),
      error: () => undefined,
    });
  }

  markRead(id: string): void {
    const target = this.findLoaded(id);
    if (!target || target.isRead) {
      return;
    }
    this.setReadLocally(id, true);
    this.service.markRead(id).subscribe({
      next: (result) => this.applyUnreadCount(result.unreadCount, result.asOfUtc),
      error: (err) => {
        this.setReadLocally(id, false);
        const message = toApiError(err).message;
        this._error.set(message);
        this._recentError.set(message);
        this.refreshUnreadCount();
      },
    });
  }

  markAllRead(): void {
    if (this._markingAll()) {
      return;
    }
    // Corte determinado por el servidor: no mandamos el reloj del cliente para que
    // una laptop con hora atrasada no deje mensajes recientes sin marcar.
    const markedIds = this.collectUnreadIds();
    this._markingAll.set(true);
    this._error.set(null);
    this._recentError.set(null);
    this.setManyReadLocally(markedIds, true);

    this.service.markAllRead(null).subscribe({
      next: (result) => {
        this.applyReadAllLocally(result.cutoffUtc);
        this.applyUnreadCount(result.unreadCount, result.asOfUtc);
        this._markingAll.set(false);
      },
      error: (err) => {
        // Rollback dirigido: solo revertimos los ids que marcamos aquí, para no
        // pisar notificaciones que llegaron durante el vuelo.
        this.setManyReadLocally(markedIds, false);
        const message = toApiError(err).message;
        this._error.set(message);
        this._recentError.set(message);
        this._markingAll.set(false);
        this.refreshUnreadCount();
      },
    });
  }

  /**
   * Marca varias filas como leídas en el servidor. Optimista + rollback dirigido
   * si el servidor rechaza (solo revertimos los ids que marcamos aquí para no
   * pisar notificaciones que llegaron durante el vuelo). Devuelve una promesa
   * que resuelve con true si se persistió, false si falló (el caller limpia la
   * selección solo en el caso bueno).
   */
  markManyRead(ids: readonly string[]): Promise<boolean> {
    const unreadIds = this.filterUnread(ids);
    if (unreadIds.size === 0 || this._applyingBulk()) return Promise.resolve(false);
    this._applyingBulk.set(true);
    this._error.set(null);
    this.setManyReadLocally(unreadIds, true);
    return new Promise((resolve) => {
      this.service.markManyRead([...unreadIds]).subscribe({
        next: (result) => {
          this.applyUnreadCount(result.unreadCount, result.asOfUtc);
          this._applyingBulk.set(false);
          resolve(true);
        },
        error: (err) => {
          this.setManyReadLocally(unreadIds, false);
          this._error.set(toApiError(err).message);
          this._applyingBulk.set(false);
          this.refreshUnreadCount();
          resolve(false);
        },
      });
    });
  }

  markManyUnread(ids: readonly string[]): Promise<boolean> {
    const readIds = this.filterRead(ids);
    if (readIds.size === 0 || this._applyingBulk()) return Promise.resolve(false);
    this._applyingBulk.set(true);
    this._error.set(null);
    this.setManyReadLocally(readIds, false);
    return new Promise((resolve) => {
      this.service.markManyUnread([...readIds]).subscribe({
        next: (result) => {
          this.applyUnreadCount(result.unreadCount, result.asOfUtc);
          this._applyingBulk.set(false);
          resolve(true);
        },
        error: (err) => {
          this.setManyReadLocally(readIds, true);
          this._error.set(toApiError(err).message);
          this._applyingBulk.set(false);
          this.refreshUnreadCount();
          resolve(false);
        },
      });
    });
  }

  /**
   * "Delete" en la UI == soft-dismiss en el backend. Optimistic: borra las filas
   * del cliente antes del request. Si el servidor falla, restauramos el snapshot
   * exacto (no un refetch — mantiene la posición y evita parpadeos).
   */
  deleteMany(ids: readonly string[]): Promise<boolean> {
    const idSet = new Set(ids);
    if (idSet.size === 0 || this._applyingBulk()) return Promise.resolve(false);
    this._applyingBulk.set(true);
    this._error.set(null);
    const itemsBefore = this._items();
    const recentBefore = this._recent();
    const dashboardBefore = this._dashboardItems();
    const totalBefore = this._total();
    const removed = this.removeManyLocally(idSet);
    this._total.set(Math.max(0, totalBefore - removed));
    return new Promise((resolve) => {
      this.service.deleteMany([...idSet]).subscribe({
        next: (result) => {
          this.applyUnreadCount(result.unreadCount, result.asOfUtc);
          this._applyingBulk.set(false);
          resolve(true);
        },
        error: (err) => {
          this._items.set(itemsBefore);
          this._recent.set(recentBefore);
          this._dashboardItems.set(dashboardBefore);
          this._total.set(totalBefore);
          this._error.set(toApiError(err).message);
          this._applyingBulk.set(false);
          this.refreshUnreadCount();
          resolve(false);
        },
      });
    });
  }

  // Throttle de visibilitychange: evita 3-4 GET en ráfaga al volver a la pestaña.
  private lastVisibilityResyncMs = 0;
  private static readonly VISIBILITY_THROTTLE_MS = 30_000;
  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - this.lastVisibilityResyncMs < NotificationsStore.VISIBILITY_THROTTLE_MS) return;
    this.lastVisibilityResyncMs = now;
    this.resyncOnReconnect();
  };

  /**
   * Resync tras reconexión de socket (o visibilitychange). Prefiere el camino
   * incremental vía `GET /notifications/since?sinceUtc=X` cuando ya hay baseline
   * (`lastSeenCreatedAtMs`): trae EXACTAMENTE lo que llegó durante el corte sin
   * perder y sin re-pegar la primera página. Si no hay baseline todavía (primera
   * carga) o si vinieron tantos items como el techo del batch (puede haber más),
   * cae al reload full de recent/firstPage/dashboard.
   */
  private resyncOnReconnect(): void {
    const since = this.lastSeenCreatedAtMs;
    if (since === Number.NEGATIVE_INFINITY) {
      this.resyncFullReload();
      return;
    }
    const sinceUtc = new Date(since).toISOString();
    this.service.since({ sinceUtc, limit: NotificationsStore.SINCE_BATCH_LIMIT }).subscribe({
      next: (result) => {
        for (const dto of result.items) {
          this.applyIncoming(dto);
        }
        this.applyUnreadCount(result.unreadCount, result.asOfUtc);
        // Si el batch vino lleno, asumimos que hay más fuera del alcance del
        // batch — caemos al reload full para no quedar con una laguna.
        if (result.items.length >= NotificationsStore.SINCE_BATCH_LIMIT) {
          this.resyncFullReload();
        }
      },
      // No romper la UI si el endpoint falla por red/5xx: caemos al reload
      // de siempre, que es más caro pero igualmente convergente.
      error: () => this.resyncFullReload(),
    });
  }

  private resyncFullReload(): void {
    this.refreshUnreadCount();
    this.loadRecent();
    if (this.pageInitialized) {
      this.loadFirstPage();
    }
    if (this.dashboardInitialized) {
      this.loadDashboard();
    }
  }

  private applyIncoming(dto: NotificationDto): void {
    const item = dtoToAppNotification(dto);
    this._recent.update((list) => this.prependUnique(list, item, RECENT_SIZE));
    if (this.pageInitialized) {
      this._items.update((list) => this.prependUnique(list, item));
    }
    if (this.dashboardInitialized) {
      this._dashboardItems.update((list) => this.prependUnique(list, item, DASHBOARD_SIZE));
    }
    this.bumpLastSeen(item.createdAtUtc);
  }

  /**
   * Avanza el cursor `lastSeenCreatedAtMs` solo hacia adelante. Lo invocan los
   * handlers del socket + los loads de HTTP cuando entra algo nuevo. El resync
   * vía `/since` usa este valor para pedir solo lo que llegó después.
   */
  private bumpLastSeen(createdAtUtc: string | undefined | null): void {
    if (!createdAtUtc) return;
    const ms = Date.parse(createdAtUtc);
    if (!Number.isFinite(ms)) return;
    if (ms > this.lastSeenCreatedAtMs) this.lastSeenCreatedAtMs = ms;
  }

  private bumpLastSeenFromItems(items: readonly AppNotification[]): void {
    for (const item of items) this.bumpLastSeen(item.createdAtUtc);
  }

  // Fila agrupada: el servidor incrementó count/params y actualizó CreatedAtUtc.
  // Si ya la tenemos cargada, la reemplazamos y la movemos al tope (comportamiento
  // visual de "la lista se sacudió"); si no, la tratamos como nueva.
  private applyUpdated(dto: NotificationDto): void {
    const item = dtoToAppNotification(dto);
    const replace = (list: AppNotification[], limit?: number): AppNotification[] => {
      const existed = list.some((current) => current.id === item.id);
      if (!existed) return this.prependUnique(list, item, limit);
      return this.prependUnique(list, item, limit);
    };
    this._recent.update((list) => replace(list, RECENT_SIZE));
    if (this.pageInitialized) {
      this._items.update((list) => replace(list));
    }
    if (this.dashboardInitialized) {
      this._dashboardItems.update((list) => replace(list, DASHBOARD_SIZE));
    }
  }

  private applyUnreadCount(count: number, asOfUtc: string): void {
    const asOfMs = this.parseVersion(asOfUtc);
    if (asOfMs <= this.lastUnreadAsOfMs) {
      return;
    }
    this.lastUnreadAsOfMs = asOfMs;
    this._unreadCount.set(Math.max(0, count));
  }

  private applyReadAllLocally(cutoffUtc: string): void {
    const cutoffMs = Date.parse(cutoffUtc);
    if (!Number.isFinite(cutoffMs)) {
      return;
    }
    const mark = (list: AppNotification[]) =>
      list.map((item) =>
        !item.isRead && item.createdAt <= cutoffMs ? { ...item, isRead: true } : item,
      );
    this._items.update(mark);
    this._recent.update(mark);
    this._dashboardItems.update(mark);
  }

  private setReadLocally(id: string, isRead: boolean): void {
    const update = (list: AppNotification[]) =>
      list.map((item) => (item.id === id ? { ...item, isRead } : item));
    this._items.update(update);
    this._recent.update(update);
    this._dashboardItems.update(update);
  }

  private setManyReadLocally(ids: ReadonlySet<string>, isRead: boolean): void {
    if (ids.size === 0) return;
    const update = (list: AppNotification[]) =>
      list.map((item) => (ids.has(item.id) ? { ...item, isRead } : item));
    this._items.update(update);
    this._recent.update(update);
    this._dashboardItems.update(update);
  }

  /** Dedupe + intersecta con lo cargado y descarta ya-leídas: fija lo que iremos a tocar. */
  private filterUnread(ids: readonly string[]): ReadonlySet<string> {
    const target = new Set(ids);
    const unread = new Set<string>();
    const sweep = (list: AppNotification[]): void => {
      for (const item of list) {
        if (target.has(item.id) && !item.isRead) unread.add(item.id);
      }
    };
    sweep(this._items());
    sweep(this._recent());
    sweep(this._dashboardItems());
    return unread;
  }

  private filterRead(ids: readonly string[]): ReadonlySet<string> {
    const target = new Set(ids);
    const read = new Set<string>();
    const sweep = (list: AppNotification[]): void => {
      for (const item of list) {
        if (target.has(item.id) && item.isRead) read.add(item.id);
      }
    };
    sweep(this._items());
    sweep(this._recent());
    sweep(this._dashboardItems());
    return read;
  }

  /** Devuelve cuántas filas se removieron de `_items` (lo que informa al total). */
  private removeManyLocally(ids: ReadonlySet<string>): number {
    const sizeBefore = this._items().length;
    const remove = (list: AppNotification[]) => list.filter((item) => !ids.has(item.id));
    this._items.update(remove);
    this._recent.update(remove);
    this._dashboardItems.update(remove);
    return sizeBefore - this._items().length;
  }

  private collectUnreadIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    const push = (list: AppNotification[]): void => {
      for (const item of list) {
        if (!item.isRead) ids.add(item.id);
      }
    };
    push(this._items());
    push(this._recent());
    push(this._dashboardItems());
    return ids;
  }

  private findLoaded(id: string): AppNotification | undefined {
    return (
      this._items().find((item) => item.id === id) ??
      this._recent().find((item) => item.id === id) ??
      this._dashboardItems().find((item) => item.id === id)
    );
  }

  private prependUnique(
    list: AppNotification[],
    item: AppNotification,
    limit?: number,
  ): AppNotification[] {
    const next = [item, ...list.filter((current) => current.id !== item.id)];
    return limit ? next.slice(0, limit) : next;
  }

  private parseVersion(asOfUtc: string): number {
    const value = Date.parse(asOfUtc);
    return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
  }
}
