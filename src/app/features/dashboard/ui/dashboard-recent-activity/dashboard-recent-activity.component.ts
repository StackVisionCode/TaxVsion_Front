import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';

type ActivityType = 'invoice' | 'payment' | 'alert' | 'session' | 'document';

interface ActivityEvent {
  id: string;
  type: ActivityType;
  icon: string;
  /** Solid circle color, keyed by activity type (Aether palette). */
  iconBg: string;
  title: string;
  time: string;
  isUrgent?: boolean;
}

/**
 * Widget "Recent Activity" (referencia "Aether"): timeline vertical con
 * círculos de icono coloreados por tipo, conector fino entre eventos y chip
 * de prioridad opcional. Datos estáticos, dominio CRM.
 */
@Component({
  selector: 'app-dashboard-recent-activity',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-recent-activity.component.html',
})
export class DashboardRecentActivityComponent {
  readonly events: ActivityEvent[] = [
    {
      id: 'act-1',
      type: 'invoice',
      icon: 'receipt-outline',
      iconBg: 'bg-indigo-600',
      title: 'Invoice #1042 sent to Acme Corp',
      time: '5m ago',
    },
    {
      id: 'act-2',
      type: 'payment',
      icon: 'checkmark-circle-outline',
      iconBg: 'bg-emerald-500',
      title: 'Maria Gonzalez completed "Prepare Q2 tax filing"',
      time: '20m ago',
    },
    {
      id: 'act-3',
      type: 'alert',
      icon: 'alert-circle-outline',
      iconBg: 'bg-orange-500',
      title: 'Acme Corp rejected the proposed contract',
      time: '1h ago',
      isUrgent: true,
    },
    {
      id: 'act-4',
      type: 'document',
      icon: 'document-text-outline',
      iconBg: 'bg-[#A99BEB]',
      title: 'Sarah Lee signed the engagement letter',
      time: '2h ago',
    },
    {
      id: 'act-5',
      type: 'payment',
      icon: 'card-outline',
      iconBg: 'bg-emerald-500',
      title: '$1,250.00 payment received from David Kim',
      time: '3h ago',
    },
    {
      id: 'act-6',
      type: 'session',
      icon: 'log-in-outline',
      iconBg: 'bg-gray-900',
      title: 'Maria Gonzalez logged in from Miami, US',
      time: 'Yesterday',
    },
  ];

  trackByEventId(_index: number, event: ActivityEvent): string {
    return event.id;
  }
}
