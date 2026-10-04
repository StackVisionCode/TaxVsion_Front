import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FilterChipOption, FilterChipsComponent } from '@shared/ui/filter-chips/filter-chips.component';
import { LoadMoreComponent } from '@shared/ui/load-more/load-more.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import {
  AppNotification,
  NotificationListComponent,
} from '../../ui/notification-list/notification-list.component';
import { NotificationsStore } from '../../data-access/notifications.store';

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
    LoadMoreComponent,
    SearchInputComponent,
    StateBlockComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './notifications-page.component.html',
})
export class NotificationsPageComponent implements OnInit {
  private readonly store = inject(NotificationsStore);

  readonly filters: FilterChipOption<NotificationFilter>[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
  ];
  readonly activeFilter = signal<NotificationFilter>('all');
  readonly search = signal('');

  readonly loading = this.store.loading;
  readonly loadingMore = this.store.loadingMore;
  readonly markingAll = this.store.markingAll;
  readonly error = this.store.error;
  readonly hasMore = this.store.hasMore;

  /** No leídas en todo el tenant (conteo del servidor). */
  readonly unreadCount = this.store.unreadCount;

  /** Notificaciones cargadas hasta ahora (no hay total global en el backend). */
  readonly totalCount = computed(() => this.store.items().length);

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
  }

  markRead(id: string): void {
    this.store.markRead(id);
  }

  markAllAsRead(): void {
    this.store.markAllRead();
  }

  loadMore(): void {
    this.store.loadMore();
  }

  retry(): void {
    this.store.loadFirstPage();
  }
}
