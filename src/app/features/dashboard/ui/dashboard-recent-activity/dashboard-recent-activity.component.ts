import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationsStore } from '../../../notifications/data-access/notifications.store';
import {
  AppNotification,
  NotificationType,
} from '../../../notifications/ui/notification-list/notification-list.component';
import { DashboardWidgetStateComponent } from '../dashboard-widget-state/dashboard-widget-state.component';

/** Cuántos eventos caben en el widget sin convertirlo en la página completa. */
const MAX_EVENTS = 6;

/**
 * Widget "Recent Activity".
 *
 * Antes era un timeline de eventos inventados ("Invoice #1042 sent to Acme
 * Corp", "$1,250.00 payment received from David Kim"…) con nombres de clientes
 * y montos que no existen.
 *
 * No hay un feed de auditoría transversal en el backend, pero SÍ existe el
 * feed de notificaciones de Communication (GET /communication/notifications),
 * que es literalmente el registro de lo que va pasando en el workspace:
 * signature.*, cloudstorage.*, customer.*, connectors.*. Así que el widget se
 * alimenta del `NotificationsStore` (providedIn: 'root', ya compartido con la
 * página de notificaciones: si esa página ya cargó, esto no repite la llamada)
 * y muestra las primeras filas de la página 1.
 *
 * Es solo lectura: marcar como leída vive en la página de notificaciones.
 */
@Component({
  selector: 'app-dashboard-recent-activity',
  imports: [CommonModule, DashboardWidgetStateComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-recent-activity.component.html',
})
export class DashboardRecentActivityComponent implements OnInit {
  private readonly store = inject(NotificationsStore);

  readonly loading = this.store.loading;
  readonly error = this.store.error;

  readonly events = computed<AppNotification[]>(() => this.store.items().slice(0, MAX_EVENTS));

  ngOnInit(): void {
    // El store es de root: si la página de notificaciones ya trajo la página 1,
    // esto simplemente la vuelve a pedir una vez al entrar al dashboard.
    if (this.store.items().length === 0) {
      this.store.loadFirstPage();
    }
  }

  trackByEventId(_index: number, event: AppNotification): string {
    return event.id;
  }

  /** Mismo criterio de iconos que la lista de notificaciones. */
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
      case 'general':
        return 'notifications-outline';
    }
  }

  /** Círculo sólido/pastel por tipo (misma paleta que el centro de notificaciones). */
  iconBgFor(type: NotificationType): string {
    switch (type) {
      case 'customer_created':
      case 'customer_updated':
      case 'customer_assigned':
        return 'bg-[#CFE2F7] text-gray-700';
      case 'payment_received':
      case 'invoice_generated':
        return 'bg-emerald-500 text-white';
      case 'document_signed':
      case 'document_uploaded':
        return 'bg-[#1E466B] text-white';
      case 'session_expiring':
      case 'subscription_expiring':
        return 'bg-orange-500 text-white';
      case 'payment_failed':
      case 'system_alert':
        return 'bg-red-500 text-white';
      case 'general':
        return 'bg-[#E7EAEE] text-gray-700';
    }
  }
}
