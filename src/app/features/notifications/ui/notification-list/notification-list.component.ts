import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { notificationIcon } from '../../data-access/notifications.model';

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
  | 'system_alert'
  /** Fallback para kinds del backend sin categoría visual específica. */
  | 'general';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  /** Etiqueta de tiempo relativo ya formateada (p. ej. "20m ago"). */
  time: string;
  /** Epoch ms de createdAtUtc (para stats Today / This week). */
  createdAt: number;
  isRead: boolean;
}

/**
 * Lista de notificaciones (estilo "Aether"): cada fila muestra un círculo de
 * icono coloreado según el tipo, título en negrita si no está leída, mensaje
 * gris truncado, tiempo relativo, un punto índigo de no leída y, solo en las
 * no leídas, un menú fantasma "..." con "Mark as read". El click en la fila
 * (fuera del menú) también marca como leída. Delete y Mark-as-unread se
 * eliminaron: el backend de Communication no expone esos endpoints por HTTP
 * (dismiss es Socket.IO-only y mark-unread no existe). Todo el estado es de
 * solo presentación: las mutaciones se emiten al padre vía @Output.
 */
@Component({
  selector: 'app-notification-list',
  imports: [CommonModule, DropdownMenuComponent, MenuItemDirective, StateBlockComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './notification-list.component.html',
})
export class NotificationListComponent {
  @Input() notifications: AppNotification[] = [];
  @Output() markRead = new EventEmitter<string>();

  trackByNotificationId(_index: number, notification: AppNotification): string {
    return notification.id;
  }

  /** Mapea el tipo de notificación a un ion-icon (mismo mapa que la campana del navbar). */
  iconFor(type: NotificationType): string {
    return notificationIcon(type);
  }

  /** Mapea el tipo a un color de círculo (paleta Aether: pasteles/sólidos). */
  iconBgFor(type: NotificationType): string {
    switch (type) {
      case 'customer_created':
      case 'customer_updated':
      case 'customer_assigned':
        return 'bg-indigo-100';
      case 'payment_received':
      case 'invoice_generated':
        return 'bg-emerald-500';
      case 'document_signed':
      case 'document_uploaded':
        return 'bg-brand-bold';
      case 'session_expiring':
      case 'subscription_expiring':
        return 'bg-orange-500';
      case 'payment_failed':
      case 'system_alert':
        return 'bg-red-500';
      case 'general':
        return 'bg-gray-200';
    }
  }

  /** El texto del icono va oscuro sobre los pasteles y blanco sobre los sólidos. */
  iconTextFor(type: NotificationType): string {
    switch (type) {
      case 'customer_created':
      case 'customer_updated':
      case 'customer_assigned':
      case 'general':
        return 'text-gray-700';
      default:
        return 'text-white';
    }
  }

  onRowClick(notification: AppNotification): void {
    if (!notification.isRead) {
      this.markRead.emit(notification.id);
    }
  }

  onMarkReadClick(notification: AppNotification): void {
    this.markRead.emit(notification.id);
  }
}
