import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Input,
  Output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/** Tipos de notificación soportados por el centro de notificaciones (dominio CRM fiscal). */
export type NotificationType =
  | 'customer_created'
  | 'customer_updated'
  | 'customer_assigned'
  | 'payment_received'
  | 'payment_failed'
  | 'invoice_generated'
  | 'document_signed'
  | 'document_uploaded'
  | 'session_expiring'
  | 'subscription_expiring'
  | 'system_alert';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  /** Etiqueta de tiempo relativo ya formateada (p. ej. "20m ago"). */
  time: string;
  isRead: boolean;
}

/**
 * Lista de notificaciones (estilo "Aether"): cada fila muestra un círculo de
 * icono coloreado según el tipo, título en negrita si no está leída, mensaje
 * gris truncado, tiempo relativo, un punto índigo de no leída y un menú
 * fantasma "..." por fila con Mark as read/unread + Delete. El click en la
 * fila (fuera del menú) marca la notificación como leída. Todo el estado es
 * de solo presentación: las mutaciones se emiten al padre vía @Output.
 */
@Component({
  selector: 'app-notification-list',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './notification-list.component.html',
})
export class NotificationListComponent {
  @Input() notifications: AppNotification[] = [];
  @Output() markRead = new EventEmitter<string>();
  @Output() markUnread = new EventEmitter<string>();
  @Output() delete = new EventEmitter<string>();

  readonly openMenuId = signal<string | null>(null);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="notification-menu"]')) {
      this.openMenuId.set(null);
    }
  }

  trackByNotificationId(_index: number, notification: AppNotification): string {
    return notification.id;
  }

  /** Mapea el tipo de notificación a un ion-icon (mismo criterio que el CRM original). */
  iconFor(type: NotificationType): string {
    switch (type) {
      case 'customer_created':
        return 'person-add-outline';
      case 'customer_updated':
        return 'person-outline';
      case 'customer_assigned':
        return 'people-outline';
      case 'payment_received':
        return 'cash-outline';
      case 'payment_failed':
        return 'alert-circle-outline';
      case 'invoice_generated':
        return 'receipt-outline';
      case 'document_signed':
        return 'checkmark-done-outline';
      case 'document_uploaded':
        return 'cloud-upload-outline';
      case 'session_expiring':
        return 'time-outline';
      case 'subscription_expiring':
        return 'warning-outline';
      case 'system_alert':
        return 'alert-outline';
    }
  }

  /** Mapea el tipo a un color de círculo (paleta Aether: pasteles/sólidos). */
  iconBgFor(type: NotificationType): string {
    switch (type) {
      case 'customer_created':
      case 'customer_updated':
      case 'customer_assigned':
        return 'bg-[#CBD9F2]';
      case 'payment_received':
      case 'invoice_generated':
        return 'bg-emerald-500';
      case 'document_signed':
      case 'document_uploaded':
        return 'bg-[#7C6AE0]';
      case 'session_expiring':
      case 'subscription_expiring':
        return 'bg-orange-500';
      case 'payment_failed':
      case 'system_alert':
        return 'bg-red-500';
    }
  }

  /** El texto del icono va oscuro sobre el pastel azul y blanco sobre los sólidos. */
  iconTextFor(type: NotificationType): string {
    return type === 'customer_created' || type === 'customer_updated' || type === 'customer_assigned'
      ? 'text-gray-700'
      : 'text-white';
  }

  toggleMenu(notification: AppNotification, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(this.openMenuId() === notification.id ? null : notification.id);
  }

  onRowClick(notification: AppNotification): void {
    if (!notification.isRead) {
      this.markRead.emit(notification.id);
    }
  }

  onMarkReadClick(notification: AppNotification, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.markRead.emit(notification.id);
  }

  onMarkUnreadClick(notification: AppNotification, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.markUnread.emit(notification.id);
  }

  onDeleteClick(notification: AppNotification, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.delete.emit(notification.id);
  }
}
