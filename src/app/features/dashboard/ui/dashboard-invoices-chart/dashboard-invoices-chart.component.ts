import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface RevenueBar {
  label: string;
  amount: number;
  /** Purple palette style class suffix for the pill bar. */
  style: 'light' | 'lighter' | 'vivid' | 'medium';
}

interface RevenueSummaryItem {
  label: string;
  amount: string;
  dot: string;
}

/**
 * "Monthly Revenue" widget (Aether reference): wide card with tall pill bars
 * for the last 6 months, a black pill tooltip that follows the hover (default
 * on the highest month) and a paid/pending/overdue summary row. Static data.
 */
@Component({
  selector: 'app-dashboard-invoices-chart',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-invoices-chart.component.html',
  styleUrl: './dashboard-invoices-chart.component.css',
})
export class DashboardInvoicesChartComponent {
  readonly bars: RevenueBar[] = [
    { label: 'Jan', amount: 22600, style: 'light' },
    { label: 'Feb', amount: 24900, style: 'lighter' },
    { label: 'Mar', amount: 25100, style: 'medium' },
    { label: 'Apr', amount: 27500, style: 'light' },
    { label: 'May', amount: 28250, style: 'lighter' },
    { label: 'Jun', amount: 31300, style: 'vivid' },
  ];

  readonly totalLabel = '$159,650';
  readonly growthLabel = '+19.9%';

  readonly summary: RevenueSummaryItem[] = [
    { label: 'Paid', amount: '$134,750', dot: 'bg-emerald-600' },
    { label: 'Pending', amount: '$17,700', dot: 'bg-orange-500' },
    { label: 'Overdue', amount: '$7,200', dot: 'bg-red-500' },
  ];

  /** Index of the bar with the visible tooltip; defaults to the highest month. */
  readonly hoveredIndex = signal<number | null>(null);

  private readonly maxAmount = Math.max(...this.bars.map(b => b.amount), 1);

  private readonly highestIndex = this.bars.reduce(
    (best, bar, index) => (bar.amount > this.bars[best].amount ? index : best),
    0,
  );

  readonly tooltipIndex = computed<number>(() => this.hoveredIndex() ?? this.highestIndex);

  barHeight(bar: RevenueBar): number {
    return Math.round((bar.amount / this.maxAmount) * 100);
  }

  tooltipLabel(bar: RevenueBar): string {
    return `$${bar.amount.toLocaleString('en-US')}`;
  }

  onBarEnter(index: number): void {
    this.hoveredIndex.set(index);
  }

  onBarLeave(): void {
    this.hoveredIndex.set(null);
  }
}
