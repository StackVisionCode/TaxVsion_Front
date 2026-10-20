import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FilterChipOption, FilterChipsComponent } from '@shared/ui/filter-chips/filter-chips.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import {
  AppNotification,
  NotificationListComponent,
} from '../../ui/notification-list/notification-list.component';
import { NotificationsStore } from '../../data-access/notifications.store';
import { NotificationRouteResolver } from '../../data-access/notification-route-resolver.service';
import { notificationActionLabel, notificationResourceLabel } from '../../data-access/notification-i18n';
import { ModalComponent } from '@shared/ui/modal/modal.component';

type NotificationFilter = 'all' | 'unread';

/**
 * Página del módulo Notifications (estilo "Aether"): barra de filtros (tabs All/Unread,
 * buscador píldora y botón negro "Mark all as read") + lista server-paged con
 * "Load more". Los datos vienen del NotificationsStore (Communication vía
 * `/communication/notifications`); ya no hay seeds locales.
 *
 * Decisiones de datos:
 * - Tab Unread = query param `unreadOnly` del backend (filtro server-side).
 * - Buscador = filtro client-side sobre lo cargado (el backend no tiene
 *   parámetro de búsqueda).
 */
@Component({
  selector: 'app-notifications-page',
  imports: [
    CommonModule,
    NotificationListComponent,
    FilterChipsComponent,
    SearchInputComponent,
    StateBlockComponent,
    ModalComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './notifications-page.component.html',
  // El host llena el alto del shell para que la tarjeta quede alineada con el sidebar (como Documents).
  host: { class: 'flex flex-1 flex-col' },
})
export class NotificationsPageComponent implements OnInit {
  private readonly store = inject(NotificationsStore);
  private readonly routes = inject(NotificationRouteResolver);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  readonly filters: FilterChipOption<NotificationFilter>[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
  ];
  readonly activeFilter = signal<NotificationFilter>('all');
  readonly search = signal('');

  readonly loading = this.store.loading;
  readonly loadingMore = this.store.loadingMore;
  readonly markingAll = this.store.markingAll;
  readonly applyingBulk = this.store.applyingBulk;
  readonly error = this.store.error;
  readonly hasMore = this.store.hasMore;

  /** No leídas en todo el tenant (conteo del servidor). */
  readonly unreadCount = this.store.unreadCount;

  /** Notificaciones cargadas hasta ahora. */
  readonly loadedCount = computed(() => this.store.items().length);
  /** Total server-side bajo el filtro actual. */
  readonly totalCount = this.store.total;
  readonly currentPage = this.store.currentPage;
  /** Total de páginas disponibles bajo el filtro actual (ceil(total/pageSize)). */
  readonly totalPages = computed(() => {
    const total = this.totalCount();
    const size = this.store.pageSize;
    return total > 0 ? Math.max(1, Math.ceil(total / size)) : 1;
  });

  // Selección múltiple — vive LOCAL en la página; no la sube al store singleton
  // porque el navbar bell y el dashboard widget comparten ese store y no deben
  // ver "noise" de selección.
  private readonly _selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly selectedIds = this._selectedIds.asReadonly();
  readonly selectedCount = computed(() => this._selectedIds().size);
  readonly hasSelection = computed(() => this._selectedIds().size > 0);
  /** Checkbox del header: checked cuando TODAS las visibles están seleccionadas. */
  readonly allVisibleSelected = computed(() => {
    const visible = this.visibleNotifications();
    if (visible.length === 0) return false;
    const sel = this._selectedIds();
    return visible.every((n) => sel.has(n.id));
  });
  /** Estado indeterminate: algunas pero no todas. */
  readonly someVisibleSelected = computed(() => {
    const visible = this.visibleNotifications();
    const sel = this._selectedIds();
    const count = visible.reduce((acc, n) => acc + (sel.has(n.id) ? 1 : 0), 0);
    return count > 0 && count < visible.length;
  });
  /** ¿Hay al menos una no-leída en la selección? Habilita "Mark as read". */
  readonly selectionHasUnread = computed(() => {
    const sel = this._selectedIds();
    return this.store.items().some((n) => sel.has(n.id) && !n.isRead);
  });
  /** ¿Hay al menos una leída en la selección? Habilita "Mark as unread". */
  readonly selectionHasRead = computed(() => {
    const sel = this._selectedIds();
    return this.store.items().some((n) => sel.has(n.id) && n.isRead);
  });
  readonly detailId = computed(() => this.queryParamMap().get('notificationId'));
  readonly detailNotification = computed(() => {
    const id = this.detailId();
    return id ? this.store.items().find(notification => notification.id === id) ?? null : null;
  });

  readonly visibleNotifications = computed<AppNotification[]>(() => {
    const query = this.search().trim().toLowerCase();
    const filter = this.activeFilter();
    return this.store
      .items()
      // En el tab Unread el feed ya viene unreadOnly del servidor; este filtro
      // extra solo oculta las que se acaban de marcar como leídas localmente.
      .filter(n => filter === 'all' || !n.isRead)
      .filter(
        n =>
          !query ||
          n.title.toLowerCase().includes(query) ||
          n.message.toLowerCase().includes(query),
      );
  });

  ngOnInit(): void {
    this.store.loadFirstPage();
  }

  setFilter(filter: NotificationFilter): void {
    this.activeFilter.set(filter);
    this.store.setUnreadOnly(filter === 'unread');
    // Al cambiar el feed la selección pierde contexto: la limpiamos para
    // evitar operar sobre ids que ya no están en pantalla.
    this.clearSelection();
  }

  markRead(id: string): void {
    this.store.markRead(id);
  }

  openNotification(notification: AppNotification): void {
    if (!notification.isRead) {
      this.store.markRead(notification.id);
    }
    void this.routes.navigate(notification);
  }

  markAllAsRead(): void {
    this.store.markAllRead();
  }

  loadMore(): void {
    this.store.loadMore();
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) return;
    this.clearSelection();
    this.store.goToPage(page);
  }

  retry(): void {
    this.store.loadFirstPage();
  }

  // Selección multiple ---------------------------------------------------------

  toggleSelected(id: string): void {
    this._selectedIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Header checkbox: si todas están seleccionadas, deselecciona; sino, selecciona todas las visibles. */
  toggleSelectAll(): void {
    if (this.allVisibleSelected()) {
      this.clearSelection();
      return;
    }
    const visibleIds = this.visibleNotifications().map((n) => n.id);
    this._selectedIds.set(new Set(visibleIds));
  }

  clearSelection(): void {
    this._selectedIds.set(new Set());
  }

  async bulkMarkRead(): Promise<void> {
    const ids = Array.from(this._selectedIds());
    const ok = await this.store.markManyRead(ids);
    if (ok) this.clearSelection();
  }

  async bulkMarkUnread(): Promise<void> {
    const ids = Array.from(this._selectedIds());
    const ok = await this.store.markManyUnread(ids);
    if (ok) this.clearSelection();
  }

  async bulkDelete(): Promise<void> {
    const ids = Array.from(this._selectedIds());
    const ok = await this.store.deleteMany(ids);
    if (ok) this.clearSelection();
  }

  closeDetail(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { notificationId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * Label del CTA primario del modal detalle: el verbo lo decide el backend
   * (consumer rellena `action` al publicar). Si no vino, caemos a "Open"
   * para no esconder el botón — la UX es que SIEMPRE haya una forma de
   * navegar al recurso.
   */
  primaryActionLabel(notification: AppNotification): string {
    return notificationActionLabel(notification.action) ?? 'Open';
  }

  /** Label legible del `resourceType` para el chip del detalle. Null si no vino. */
  resourceLabel(notification: AppNotification): string | null {
    return notificationResourceLabel(notification.resourceType);
  }

  openFromDetail(notification: AppNotification): void {
    this.openNotification(notification);
    this.closeDetail();
  }
}
