import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Static monthly revenue breakdown (paid / pending / overdue) rendered as a
 * plain CSS bar chart. The original never used chart.js/ng2-charts either —
 * bars are just divs whose height is driven by `[style.height.px]` — so no
 * charting library needs to be reimplemented here, just re-pointed at mock
 * data. AccountService/AssignmentService/TokenService (which decided whose
 * invoices to load — owner, a selected teammate, or assigned customers only)
 * are gone; the widget now always renders the same six-month dataset.
 */
interface MonthlyInvoiceDataPoint {
  month: string;
  shortMonth: string;
  paid: number;
  pending: number;
  overdue: number;
  invoiceCount: number;
}

interface InvoiceStats {
  totalAmount: number;
  averageAmount: number;
  totalInvoices: number;
  paidAmount: number;
  pendingAmount: number;
  overdueAmount: number;
  growthPercentage: number;
}

@Component({
  selector: 'app-dashboard-invoices-chart',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-invoices-chart.component.html',
  styleUrl: './dashboard-invoices-chart.component.scss',
})
export class DashboardInvoicesChartComponent {
  private readonly maxChartHeight = 128;

  readonly currency = signal('USD');

  readonly chartData = signal<MonthlyInvoiceDataPoint[]>([
    { month: 'January', shortMonth: 'Jan', paid: 18500, pending: 3200, overdue: 900, invoiceCount: 24 },
    { month: 'February', shortMonth: 'Feb', paid: 21300, pending: 2100, overdue: 1500, invoiceCount: 27 },
    { month: 'March', shortMonth: 'Mar', paid: 19800, pending: 4600, overdue: 700, invoiceCount: 26 },
    { month: 'April', shortMonth: 'Apr', paid: 24500, pending: 1800, overdue: 1200, invoiceCount: 31 },
    { month: 'May', shortMonth: 'May', paid: 22750, pending: 3400, overdue: 2100, invoiceCount: 29 },
    { month: 'June', shortMonth: 'Jun', paid: 27900, pending: 2600, overdue: 800, invoiceCount: 34 },
  ]);

  private readonly maxMonthlyTotal = computed(() =>
    Math.max(...this.chartData().map(point => point.paid + point.pending + point.overdue), 1)
  );

  readonly stats = computed<InvoiceStats>(() => {
    const data = this.chartData();
    const totalAmount = data.reduce((sum, point) => sum + point.paid + point.pending + point.overdue, 0);
    const totalInvoices = data.reduce((sum, point) => sum + point.invoiceCount, 0);
    const paidAmount = data.reduce((sum, point) => sum + point.paid, 0);
    const pendingAmount = data.reduce((sum, point) => sum + point.pending, 0);
    const overdueAmount = data.reduce((sum, point) => sum + point.overdue, 0);
    const averageAmount = data.length > 0 ? totalAmount / data.length : 0;

    const midPoint = Math.floor(data.length / 2);
    const firstHalfTotal = data
      .slice(0, midPoint)
      .reduce((sum, point) => sum + point.paid + point.pending + point.overdue, 0);
    const secondHalfTotal = data
      .slice(midPoint)
      .reduce((sum, point) => sum + point.paid + point.pending + point.overdue, 0);

    const growthPercentage = firstHalfTotal > 0
      ? Math.round(((secondHalfTotal - firstHalfTotal) / firstHalfTotal) * 1000) / 10
      : 0;

    return { totalAmount, averageAmount, totalInvoices, paidAmount, pendingAmount, overdueAmount, growthPercentage };
  });

  /** Bar height in px, scaled against the tallest month in the dataset. */
  getBarHeight(point: MonthlyInvoiceDataPoint): number {
    const total = point.paid + point.pending + point.overdue;
    const value = (total / this.maxMonthlyTotal()) * 100;
    return Math.max(8, (value / 100) * this.maxChartHeight);
  }

  getBarGradient(index: number): string {
    const colors = [
      'linear-gradient(135deg, #10b981 0%, #34d399 100%)', // Green
      'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)', // Blue
      'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)', // Purple
      'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)', // Orange
      'linear-gradient(135deg, #ef4444 0%, #f87171 100%)', // Red
      'linear-gradient(135deg, #06b6d4 0%, #38bdf8 100%)', // Cyan
      'linear-gradient(135deg, #84cc16 0%, #a3e635 100%)', // Lime
    ];
    return colors[index % colors.length];
  }

  formatAmount(amount: number): string {
    const symbols: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
    const symbol = symbols[this.currency()] ?? '$';
    return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  formatNumber(num: number): string {
    return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
}
