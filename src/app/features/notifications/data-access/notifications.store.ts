import { Injectable, inject, signal } from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { AppNotification } from '../ui/notification-list/notification-list.component';
import { NotificationDto, dtoToAppNotification } from './notifications.model';
import { NotificationsService } from './notifications.service';

/** Cuántas notificaciones recientes muestra la campana del navbar. */
const RECENT_SIZE = 8;

/** Tamaño de página del listado server-paged (el backend acepta 1–100). */
const PAGE_SIZE = 20;

/**
 * Store de notificaciones (signals, providedIn: 'root' — mismo patrón que
 * ClientsStore). Server-paged: `loadFirstPage()` trae la página 1 del feed
 * activo y `loadMore()` va anexando páginas siguientes. El envelope del
 * backend no trae total global, así que `hasMore` se infiere de si la última
 * página vino llena (items.length === size).
 *
 * El tab Unread usa el query param `unreadOnly` del backend (filtro
 * server-side, no client-side). `unreadCount` es siempre el conteo del
 * servidor sobre TODO el tenant (viene en cada envelope de listado y en
 * /unread-count).
 *
 * Mark-all-read: el backend NO tiene endpoint bulk, así que se postea
 * POST /{id}/read por cada no leída CARGADA; las no leídas en páginas aún no
 * cargadas quedan sin marcar (por eso al terminar se re-lee /unread-count del
 * servidor en vez de asumir 0).
 */
@Injectable({ providedIn: 'root' })
export class NotificationsStore {
  private readonly service = inject(NotificationsService);
  private readonly realtime = inject(CommunicationRealtimeService);

  private readonly _items = signal<AppNotification[]>([]);
  /** Feed corto para la campana del navbar (todas, independiente del tab de la página). */
  private readonly _recent = signal<AppNotification[]>([]);
  readonly recent = this._recent.asReadonly();
  private realtimeWired = false;
  private readonly _loading = signal(false);
  private readonly _loadingMore = signal(false);
  private readonly _markingAll = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _unreadCount = signal(0);
  private readonly _unreadOnly = signal(false);
  private readonly _page = signal(1);
  private readonly _hasMore = signal(false);

  /** Notificaciones cargadas hasta ahora del feed activo (all o unread-only). */
  readonly items = this._items.asReadonly();
  /** Cargando la página 1 (primer load o cambio de tab). */
  readonly loading = this._loading.asReadonly();
  /** Cargando una página siguiente (append). */
  readonly loadingMore = this._loadingMore.asReadonly();
  /** "Mark all as read" en curso. */
  readonly markingAll = this._markingAll.asReadonly();
  readonly error = this._error.asReadonly();
  /** No leídas en todo el tenant, según el servidor. */
  readonly unreadCount = this._unreadCount.asReadonly();
  readonly unreadOnly = this._unreadOnly.asReadonly();
  /** La última página vino llena: probablemente hay más para cargar. */
  readonly hasMore = this._hasMore.asReadonly();

  /**
   * Cablea el tiempo real (una vez) y carga el feed corto de la campana. Lo llama el
   * shell al entrar: `notification.received` antepone; `notification.unread_count.changed`
   * fija el conteo. Independiente del listado paginado de la página.
   */
  startRealtime(): void {
    if (!this.realtimeWired) {
      this.realtimeWired = true;
      this.realtime.on<NotificationDto>('notification.received').subscribe(dto => this.applyIncoming(dto));
      this.realtime.on<{ count: number }>('notification.unread_count.changed').subscribe(dto => this._unreadCount.set(dto.count));
    }
    this.loadRecent();
  }

  /** Feed corto (todas, page 1) para la campana — no toca el listado paginado de la página. */
  loadRecent(): void {
    this.service.list({ page: 1, size: RECENT_SIZE }).subscribe({
      next: result => {
        this._recent.set(result.items.map(dtoToAppNotification));
        this._unreadCount.set(result.unreadCount);
      },
      error: () => undefined,
    });
  }

  /** Notificación entrante en vivo: la antepone a la campana y al listado activo. */
  private applyIncoming(dto: NotificationDto): void {
    const item = dtoToAppNotification(dto);
    this._recent.update(list => (list.some(n => n.id === item.id) ? list : [item, ...list].slice(0, RECENT_SIZE)));
    // Una entrante es no-leída → cabe tanto en "all" como en "unread".
    this._items.update(list => (list.some(n => n.id === item.id) ? list : [item, ...list]));
  }

  /** Página 1 del feed activo. Resetea la paginación y el error. */
  loadFirstPage(): void {
    this._loading.set(true);
    this._error.set(null);
    this.service
      .list({ page: 1, size: PAGE_SIZE, unreadOnly: this._unreadOnly() || undefined })
      .subscribe({
        next: result => {
          this._items.set(result.items.map(dtoToAppNotification));
          this._page.set(result.page);
          this._unreadCount.set(result.unreadCount);
          this._hasMore.set(result.items.length === result.size);
          this._loading.set(false);
        },
        error: err => {
          this._error.set(toApiError(err).message);
          this._loading.set(false);
        },
      });
  }

  /** Anexa la página siguiente (dedupe por id por si entraron filas nuevas arriba). */
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
        next: result => {
          this._items.update(list => {
            const known = new Set(list.map(n => n.id));
            return [...list, ...result.items.map(dtoToAppNotification).filter(n => !known.has(n.id))];
          });
          this._page.set(nextPage);
          this._unreadCount.set(result.unreadCount);
          this._hasMore.set(result.items.length === result.size);
          this._loadingMore.set(false);
        },
        error: err => {
          this._error.set(toApiError(err).message);
          this._loadingMore.set(false);
        },
      });
  }

  /** Cambia entre el feed completo y el server-side `unreadOnly` (tab Unread). */
  setUnreadOnly(value: boolean): void {
    if (this._unreadOnly() === value) {
      return;
    }
    this._unreadOnly.set(value);
    this.loadFirstPage();
  }

  /** Re-lee el conteo de no leídas del servidor (best-effort). */
  refreshUnreadCount(): void {
    this.service.unreadCount().subscribe({
      next: result => this._unreadCount.set(result.count),
      error: () => undefined,
    });
  }

  /**
   * POST /{id}/read con update optimista; rollback si el backend falla.
   * El unreadCount definitivo lo devuelve el propio endpoint.
   */
  markRead(id: string): void {
    const target = this._items().find(n => n.id === id) ?? this._recent().find(n => n.id === id);
    if (!target || target.isRead) {
      return;
    }
    this.setReadLocally(id, true);
    this._unreadCount.update(count => Math.max(0, count - 1));
    this.service.markRead(id).subscribe({
      next: result => this._unreadCount.set(result.unreadCount),
      error: err => {
        this.setReadLocally(id, false);
        this._error.set(toApiError(err).message);
        this.refreshUnreadCount();
      },
    });
  }

  private setReadLocally(id: string, isRead: boolean): void {
    this._items.update(list => list.map(n => (n.id === id ? { ...n, isRead } : n)));
    this._recent.update(list => list.map(n => (n.id === id ? { ...n, isRead } : n)));
  }

  /**
   * Sin endpoint bulk en el backend: marca una a una las no leídas cargadas
   * (best-effort por fila) y después sincroniza el conteo con el servidor,
   * porque pueden quedar no leídas en páginas no cargadas.
   */
  markAllRead(): void {
    const unread = this._items().filter(n => !n.isRead);
    if (unread.length === 0 || this._markingAll()) {
      return;
    }
    this._markingAll.set(true);
    this._items.update(list => list.map(n => (n.isRead ? n : { ...n, isRead: true })));
    this._recent.update(list => list.map(n => (n.isRead ? n : { ...n, isRead: true })));
    forkJoin(
      unread.map(n => this.service.markRead(n.id).pipe(catchError(() => of(null)))),
    ).subscribe(results => {
      this._markingAll.set(false);
      if (results.some(r => r === null)) {
        this._error.set('Some notifications could not be marked as read.');
        this.loadFirstPage();
        return;
      }
      this.refreshUnreadCount();
    });
  }
}
