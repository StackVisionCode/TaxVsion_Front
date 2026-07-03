import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Static placeholder activity feed for the dashboard widget. No
 * notification/websocket services attached — clicking an unread notification
 * only flips its local `isRead` flag via the `activities` signal, it does not
 * call a backend.
 */
type ActivityKind = 'notification' | 'session';

interface ActivityItem {
  id: string;
  type: ActivityKind;
  icon: string;
  iconColor: string;
  title: string;
  description: string;
  relativeTime: string;
  isRead: boolean;
  priorityLabel?: string;
  location?: string;
  device?: string;
}

@Component({
  selector: 'app-dashboard-recent-activity',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-recent-activity.component.html',
  styleUrl: './dashboard-recent-activity.component.scss',
})
export class DashboardRecentActivityComponent {
  readonly activities = signal<ActivityItem[]>([
    {
      id: 'act-1',
      type: 'notification',
      icon: 'receipt',
      iconColor: 'text-blue-600 bg-blue-100',
      title: 'Invoice #1042 sent',
      description: 'Invoice #1042 sent to Acme Corp for $3,200.00',
      relativeTime: '5m ago',
      isRead: false,
    },
    {
      id: 'act-2',
      type: 'notification',
      icon: 'checkmark-circle',
      iconColor: 'text-emerald-600 bg-emerald-100',
      title: 'Task completed',
      description: 'Maria Gonzalez completed "Prepare Q2 tax filing"',
      relativeTime: '20m ago',
      isRead: false,
    },
    {
      id: 'act-3',
      type: 'notification',
      icon: 'person-add',
      iconColor: 'text-blue-600 bg-blue-100',
      title: 'New client added',
      description: 'John Doe was added as a new client',
      relativeTime: '1h ago',
      isRead: true,
    },
    {
      id: 'act-4',
      type: 'notification',
      icon: 'document-text',
      iconColor: 'text-blue-600 bg-blue-100',
      title: 'Document signed',
      description: 'Sarah Lee signed the engagement letter',
      relativeTime: '2h ago',
      isRead: true,
    },
    {
      id: 'act-5',
      type: 'notification',
      icon: 'card',
      iconColor: 'text-orange-600 bg-orange-100',
      title: 'Payment received',
      description: '$1,250.00 received from David Kim',
      relativeTime: '3h ago',
      isRead: false,
      priorityLabel: 'High priority',
    },
    {
      id: 'act-6',
      type: 'notification',
      icon: 'close-circle',
      iconColor: 'text-red-600 bg-red-100',
      title: 'Signature rejected',
      description: 'Acme Corp rejected the proposed contract',
      relativeTime: '4h ago',
      isRead: false,
      priorityLabel: 'Urgent',
    },
    {
      id: 'act-7',
      type: 'session',
      icon: 'log-in',
      iconColor: 'text-emerald-600 bg-emerald-100',
      title: 'Logged in',
      description: 'Maria Gonzalez',
      relativeTime: 'Yesterday',
      isRead: true,
      location: 'Miami, US',
      device: 'Chrome on macOS',
    },
    {
      id: 'act-8',
      type: 'session',
      icon: 'shield-checkmark',
      iconColor: 'text-red-600 bg-red-100',
      title: 'Session revoked',
      description: 'John Smith',
      relativeTime: '2 days ago',
      isRead: true,
      location: 'New York, US',
      device: 'Safari on iOS',
    },
  ]);

  readonly hasActivities = computed(() => this.activities().length > 0);
  readonly displayedActivities = computed(() => this.activities().slice(0, 8));

  handleActivityClick(activity: ActivityItem): void {
    // Purely local read-state toggle — no backend call.
    if (activity.type === 'notification' && !activity.isRead) {
      this.activities.update(items =>
        items.map(item => (item.id === activity.id ? { ...item, isRead: true } : item))
      );
    }
  }

  trackByActivityId(_index: number, activity: ActivityItem): string {
    return activity.id;
  }
}
