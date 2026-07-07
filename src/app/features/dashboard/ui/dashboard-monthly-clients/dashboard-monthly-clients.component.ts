import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';

type ClientType = 'Individual' | 'Business';

interface MonthBar {
  /** Month initial shown under the bar. */
  label: string;
  count: number;
  /** Purple palette hex; the current month uses the vivid #7C6AE0. */
  color: string;
}

interface RecentClient {
  name: string;
  initials: string;
  avatarBg: string;
  type: ClientType;
  revenue: string;
}

/**
 * "New Clients" widget (Aether reference): monthly growth summary with a big
 * headline number, a green outline delta chip, a mini pill-bar chart of the
 * last 6 months and a short "Recent additions" list. Static data, no backend.
 */
@Component({
  selector: 'app-dashboard-monthly-clients',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-monthly-clients.component.html',
})
export class DashboardMonthlyClientsComponent {
  readonly currentMonthCount = 23;
  readonly monthlyDelta = '+12% vs last month';

  readonly months: MonthBar[] = [
    { label: 'J', count: 14, color: '#D6CEF4' },
    { label: 'F', count: 19, color: '#A99BEB' },
    { label: 'M', count: 16, color: '#D6CEF4' },
    { label: 'A', count: 21, color: '#9D8DE8' },
    { label: 'M', count: 18, color: '#D6CEF4' },
    { label: 'J', count: 23, color: '#7C6AE0' },
  ];

  readonly recentClients: RecentClient[] = [
    { name: 'Olivia Martin', initials: 'OM', avatarBg: 'bg-gray-900', type: 'Individual', revenue: '$4,200' },
    { name: 'Jackson Reyes', initials: 'JR', avatarBg: 'bg-indigo-600', type: 'Business', revenue: '$9,800' },
    { name: 'Sofia Chen', initials: 'SC', avatarBg: 'bg-gray-900', type: 'Individual', revenue: '$2,650' },
  ];

  private readonly maxCount = Math.max(...this.months.map(m => m.count), 1);

  barHeight(month: MonthBar): number {
    return Math.round((month.count / this.maxCount) * 100);
  }

  typeChipClass(type: ClientType): string {
    return type === 'Business'
      ? 'border-indigo-200 text-indigo-600'
      : 'border-gray-200 text-gray-500';
  }
}
