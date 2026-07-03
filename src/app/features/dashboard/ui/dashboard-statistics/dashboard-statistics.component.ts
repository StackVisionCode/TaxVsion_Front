import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Static placeholder statistics for the dashboard summary cards. No inputs
 * required — the numbers are realistic mock values baked into the component
 * so the widget can be dropped into any layout and still render fully
 * populated. `refreshStatistics()` only replays a short local spinner
 * animation; it is not wired to a backend yet.
 */
interface DashboardStatistics {
  totalCustomers: number;
  pendingInvoices: number;
  monthlyRevenue: number;
  signedDocuments: number;
}

@Component({
  selector: 'app-dashboard-statistics',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-statistics.component.html',
  styleUrl: './dashboard-statistics.component.scss',
})
export class DashboardStatisticsComponent {
  readonly loading = signal(false);

  readonly statistics = signal<DashboardStatistics>({
    totalCustomers: 128,
    pendingInvoices: 14,
    monthlyRevenue: 42500,
    signedDocuments: 37,
  });

  refreshStatistics(): void {
    // Purely cosmetic — no backend call yet, just replays the spinner briefly.
    this.loading.set(true);
    setTimeout(() => this.loading.set(false), 600);
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }
}
