import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  QueryList,
  ViewChild,
  ViewChildren,
  computed,
  signal,
} from '@angular/core';
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
 * for the last 6 months, a black pill tooltip that SLIDES with the hover (a
 * single persistent element, position measured via getBoundingClientRect —
 * same pattern as the sidebar's active pill — instead of mounting/unmounting
 * a tooltip per bar, which made it jump) and a paid/pending/overdue summary
 * row. Static data.
 */
@Component({
  selector: 'app-dashboard-invoices-chart',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-invoices-chart.component.html',
  styleUrl: './dashboard-invoices-chart.component.css',
})
export class DashboardInvoicesChartComponent implements AfterViewInit {
  @ViewChild('chartTrack') private chartTrackRef?: ElementRef<HTMLElement>;
  @ViewChildren('barBox') private barBoxes?: QueryList<ElementRef<HTMLElement>>;

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

  /** Index of the bar with the visible tooltip; "sticky" — stays on the last
   *  hovered bar instead of resetting when the mouse leaves. Defaults to the
   *  highest month until the first hover. */
  readonly hoveredIndex = signal<number | null>(null);

  private readonly maxAmount = Math.max(...this.bars.map(b => b.amount), 1);

  private readonly highestIndex = this.bars.reduce(
    (best, bar, index) => (bar.amount > this.bars[best].amount ? index : best),
    0,
  );

  readonly tooltipIndex = computed<number>(() => this.hoveredIndex() ?? this.highestIndex);
  readonly tooltipBar = computed<RevenueBar>(() => this.bars[this.tooltipIndex()]);

  /** Posición del tooltip deslizante, en px relativos a #chartTrack (no %: inmune a gaps/padding). */
  readonly tooltipLeft = signal(0);
  readonly tooltipTop = signal(0);
  readonly tooltipReady = signal(false);

  ngAfterViewInit(): void {
    this.syncTooltipPosition();
  }

  barHeight(bar: RevenueBar): number {
    return Math.round((bar.amount / this.maxAmount) * 100);
  }

  tooltipLabel(bar: RevenueBar): string {
    return `$${bar.amount.toLocaleString('en-US')}`;
  }

  onBarEnter(index: number): void {
    this.hoveredIndex.set(index);
    this.syncTooltipPosition();
  }

  /**
   * Mide la posición real de la barra activa (getBoundingClientRect, no
   * porcentajes del CSS) para que el tooltip se deslice con precisión sin
   * importar anchos/gaps del flex — mismo patrón que el pill del sidebar.
   */
  private syncTooltipPosition(): void {
    const container = this.chartTrackRef?.nativeElement;
    const boxes = this.barBoxes?.toArray();
    const index = this.tooltipIndex();
    const bar = this.tooltipBar();
    const box = boxes?.[index]?.nativeElement;
    if (!container || !box || !bar) {
      this.tooltipReady.set(false);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const barTopY = boxRect.bottom - (boxRect.height * this.barHeight(bar)) / 100;

    this.tooltipLeft.set(boxRect.left - containerRect.left + boxRect.width / 2);
    this.tooltipTop.set(barTopY - containerRect.top);
    this.tooltipReady.set(true);
  }
}
