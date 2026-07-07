import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AppNotification,
  NotificationListComponent,
} from '../../ui/notification-list/notification-list.component';

type NotificationFilter = 'all' | 'unread';

const SEED_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'notif-1',
    type: 'customer_created',
    title: 'New client added: Maria Gonzalez',
    message: 'Maria Gonzalez was created and assigned to your book of business.',
    time: 'Just now',
    isRead: false,
  },
  {
    id: 'notif-2',
    type: 'payment_received',
    title: 'Payment received: $850 from Johnson & Co',
    message: 'Invoice INV-2026-0131 was paid in full via bank transfer.',
    time: '20m ago',
    isRead: false,
  },
  {
    id: 'notif-3',
    type: 'document_signed',
    title: 'Form 8879 signed by David Chen',
    message: 'The e-file authorization is complete and ready to transmit.',
    time: '45m ago',
    isRead: false,
  },
  {
    id: 'notif-4',
    type: 'invoice_generated',
    title: 'Invoice INV-2026-0142 generated',
    message: 'A new invoice for James Cooper Consulting was created for $990.',
    time: '1h ago',
    isRead: false,
  },
  {
    id: 'notif-5',
    type: 'session_expiring',
    title: 'Your session expires in 10 minutes',
    message: 'Save your work to avoid losing unsaved changes.',
    time: '1h ago',
    isRead: false,
  },
  {
    id: 'notif-6',
    type: 'payment_failed',
    title: 'Payment failed: Sunrise Bakery Inc.',
    message: 'The card on file was declined for invoice INV-2026-0133.',
    time: '2h ago',
    isRead: true,
  },
  {
    id: 'notif-7',
    type: 'customer_assigned',
    title: 'Client assigned: Robert Kim',
    message: 'Robert Kim was reassigned to you by the workspace admin.',
    time: '2h ago',
    isRead: true,
  },
  {
    id: 'notif-8',
    type: 'document_uploaded',
    title: 'W-2 uploaded by Sarah Kim',
    message: 'A new tax document is ready for review in the client portal.',
    time: '4h ago',
    isRead: false,
  },
  {
    id: 'notif-9',
    type: 'customer_updated',
    title: 'Client profile updated: Nguyen Enterprises',
    message: 'The mailing address and EIN were updated for this account.',
    time: 'Yesterday',
    isRead: true,
  },
  {
    id: 'notif-10',
    type: 'subscription_expiring',
    title: 'Your subscription expires in 5 days',
    message: 'Renew the Pro plan to keep unlimited filings and e-signatures.',
    time: 'Yesterday',
    isRead: false,
  },
  {
    id: 'notif-11',
    type: 'system_alert',
    title: 'Scheduled maintenance this weekend',
    message: 'The platform will be briefly unavailable on Saturday at 2:00 AM ET.',
    time: '3 days ago',
    isRead: true,
  },
  {
    id: 'notif-12',
    type: 'payment_received',
    title: 'Payment received: $350 from Sarah Kim',
    message: 'Invoice INV-2026-0138 was paid in full via credit card.',
    time: '3 days ago',
    isRead: true,
  },
];

/**
 * Página del módulo Notifications (estilo "Aether"): fila de stats pastel
 * (Total / Unread / Today / This week) + barra de filtros (tabs All/Unread,
 * buscador píldora y botón negro "Mark all as read") + lista de
 * notificaciones. Todo el estado vive en signals dentro de esta página, con
 * datos estáticos y sin servicios ni backend; las mutaciones (leer/no leer,
 * eliminar, filtrar, buscar) son cambios locales de signals. Reemplaza al
 * centro de notificaciones del CRM original (WebSocket, paginación, API) por
 * una versión de solo presentación.
 */
@Component({
  selector: 'app-notifications-page',
  imports: [CommonModule, FormsModule, NotificationListComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './notifications-page.component.html',
})
export class NotificationsPageComponent {
  readonly notifications = signal<AppNotification[]>(SEED_NOTIFICATIONS);

  readonly filters: NotificationFilter[] = ['all', 'unread'];
  readonly activeFilter = signal<NotificationFilter>('all');
  readonly search = signal('');

  readonly totalCount = computed(() => this.notifications().length);

  readonly unreadCount = computed(() => this.notifications().filter(n => !n.isRead).length);

  readonly todayCount = computed(
    () =>
      this.notifications().filter(n =>
        ['Just now', '20m ago', '45m ago', '1h ago', '2h ago', '4h ago'].includes(n.time),
      ).length,
  );

  readonly thisWeekCount = computed(
    () => this.notifications().filter(n => n.time !== '3 days ago').length,
  );

  readonly visibleNotifications = computed<AppNotification[]>(() => {
    const query = this.search().trim().toLowerCase();
    const filter = this.activeFilter();
    return this.notifications()
      .filter(n => filter === 'all' || !n.isRead)
      .filter(
        n =>
          !query ||
          n.title.toLowerCase().includes(query) ||
          n.message.toLowerCase().includes(query),
      );
  });

  filterLabel(filter: NotificationFilter): string {
    return filter === 'all' ? 'All' : 'Unread';
  }

  setFilter(filter: NotificationFilter): void {
    this.activeFilter.set(filter);
  }

  markRead(id: string): void {
    this.notifications.update(list =>
      list.map(n => (n.id === id ? { ...n, isRead: true } : n)),
    );
  }

  markUnread(id: string): void {
    this.notifications.update(list =>
      list.map(n => (n.id === id ? { ...n, isRead: false } : n)),
    );
  }

  markAllAsRead(): void {
    this.notifications.update(list => list.map(n => ({ ...n, isRead: true })));
  }

  deleteNotification(id: string): void {
    this.notifications.update(list => list.filter(n => n.id !== id));
  }
}
