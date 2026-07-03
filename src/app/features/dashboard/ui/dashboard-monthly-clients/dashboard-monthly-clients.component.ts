import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Static customer-growth summary + "recent additions" list. The original
 * pulled live counts from CustomerService/AssignmentService/LoginService,
 * split by owner-vs-assigned customers, and opened a real customer-detail
 * modal driven by backend records. Here everything is baked-in mock data via
 * signal(): a monthly new-client trend backs the week/month stat cards, and
 * a fixed list of five fake clients fills the "recent additions" panel and
 * its detail modal (still fully clickable, just no navigation/service calls
 * behind it).
 */
interface MonthlyClientPoint {
  month: string;
  count: number;
}

interface DashboardClient {
  id: string;
  name: string;
  initials: string;
  email: string;
  customerType: string;
  isActive: boolean;
  revenue: number;
  createdAt: Date;
  relativeLabel: string;
}

interface ClientGrowthStats {
  weeklyCount: number;
  monthlyCount: number;
  weeklyGrowth: number;
  monthlyGrowth: number;
  companyWeeklyCount: number;
  companyMonthlyCount: number;
}

@Component({
  selector: 'app-dashboard-monthly-clients',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-monthly-clients.component.html',
  styleUrl: './dashboard-monthly-clients.component.scss',
})
export class DashboardMonthlyClientsComponent {
  /** Always shows the "company total" panel — there is no real owner/role check anymore. */
  readonly isOwner = signal(true);

  readonly monthlyNewClients = signal<MonthlyClientPoint[]>([
    { month: 'Jan', count: 14 },
    { month: 'Feb', count: 19 },
    { month: 'Mar', count: 16 },
    { month: 'Apr', count: 23 },
    { month: 'May', count: 21 },
    { month: 'Jun', count: 27 },
  ]);

  private readonly companyMonthlyNewClients = signal<MonthlyClientPoint[]>([
    { month: 'Jan', count: 41 },
    { month: 'Feb', count: 47 },
    { month: 'Mar', count: 44 },
    { month: 'Apr', count: 52 },
    { month: 'May', count: 49 },
    { month: 'Jun', count: 58 },
  ]);

  readonly stats = computed<ClientGrowthStats>(() => {
    const own = this.monthlyNewClients();
    const company = this.companyMonthlyNewClients();
    const latest = own[own.length - 1];
    const previous = own[own.length - 2];
    const companyLatest = company[company.length - 1];

    const monthlyGrowth = previous && previous.count > 0
      ? Math.round(((latest.count - previous.count) / previous.count) * 1000) / 10
      : 0;

    return {
      weeklyCount: 7,
      monthlyCount: latest.count,
      weeklyGrowth: 16.7,
      monthlyGrowth,
      companyWeeklyCount: 18,
      companyMonthlyCount: companyLatest.count,
    };
  });

  readonly recentClients = signal<DashboardClient[]>([
    {
      id: 'c-1',
      name: 'Olivia Martin',
      initials: 'OM',
      email: 'olivia.martin@example.com',
      customerType: 'Individual',
      isActive: true,
      revenue: 4200,
      createdAt: new Date(2026, 5, 29),
      relativeLabel: 'Today',
    },
    {
      id: 'c-2',
      name: 'Jackson Reyes',
      initials: 'JR',
      email: 'jackson.reyes@example.com',
      customerType: 'Business',
      isActive: true,
      revenue: 9800,
      createdAt: new Date(2026, 5, 27),
      relativeLabel: '2 days ago',
    },
    {
      id: 'c-3',
      name: 'Sofia Chen',
      initials: 'SC',
      email: 'sofia.chen@example.com',
      customerType: 'Individual',
      isActive: true,
      revenue: 2650,
      createdAt: new Date(2026, 5, 24),
      relativeLabel: '5 days ago',
    },
    {
      id: 'c-4',
      name: 'Marcus Bennett',
      initials: 'MB',
      email: 'marcus.bennett@example.com',
      customerType: 'Business',
      isActive: false,
      revenue: 6100,
      createdAt: new Date(2026, 5, 18),
      relativeLabel: '11 days ago',
    },
    {
      id: 'c-5',
      name: 'Amelia Torres',
      initials: 'AT',
      email: 'amelia.torres@example.com',
      customerType: 'Individual',
      isActive: true,
      revenue: 3475,
      createdAt: new Date(2026, 5, 12),
      relativeLabel: '17 days ago',
    },
  ]);

  readonly selectedClient = signal<DashboardClient | null>(null);
  readonly showModal = signal(false);

  getGrowthClass(growth: number): string {
    if (growth > 0) return 'text-emerald-600';
    if (growth < 0) return 'text-red-600';
    return 'text-gray-600';
  }

  getGrowthIcon(growth: number): string {
    if (growth > 0) return 'trending-up-outline';
    if (growth < 0) return 'trending-down-outline';
    return 'remove-outline';
  }

  getStatusColor(isActive: boolean): string {
    return isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700';
  }

  getStatusLabel(isActive: boolean): string {
    return isActive ? 'Active' : 'Inactive';
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  openClientModal(client: DashboardClient): void {
    this.selectedClient.set(client);
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
    this.selectedClient.set(null);
  }
}
