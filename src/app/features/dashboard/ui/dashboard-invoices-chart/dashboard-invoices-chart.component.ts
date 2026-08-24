import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  DashboardInvoicesStore,
  MonthlyRevenueBucket,
  formatCents,
} from '../../data-access/dashboard-invoices.store';
import { DashboardWidgetStateComponent } from '../dashboard-widget-state/dashboard-widget-state.component';

interface SummaryItem {
  label: string;
  value: string;
  dot: string;
}

/**
 * Widget "Revenue Collected".
 *
 * Antes era un gráfico de 6 meses con importes inventados ($22,600 … $31,300),
 * un total de "$159,650", un "+19.9%" fijo y un resumen Paid/Pending/Overdue
 * también literal.
 *
 * Ahora todo sale de `GET /billing/invoices` a través del
 * {@link DashboardInvoicesStore} (compartido con el hero, una sola petición):
 *  - Cada barra es la suma de `amountPaidCents` de las facturas cuya
 *    `paidAtUtc` cae en ese mes — dinero realmente cobrado, no facturado.
 *  - El total es la suma de esos 6 meses.
 *  - El delta se calcula contra el mes anterior y se OCULTA si ese mes fue 0
 *    (no hay base para un porcentaje).
 *
 * Se cayó la categoría "Overdue": `InvoiceSummary` no trae vencimiento y el
 * enum del backend (Draft/Issued/Sent/PartiallyPaid/Paid/Voided) no tiene
 * estado vencido. En su lugar el resumen muestra Collected / Outstanding /
 * Drafts, que sí se derivan del contrato real.
 *
 * El tooltip deslizante se conserva tal cual (es UI, no dato): un único
 * elemento cuya posición se mide con getBoundingClientRect.
 */
@Component({
  selector: 'app-dashboard-invoices-chart',
  imports: [CommonModule, DashboardWidgetStateComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-invoices-chart.component.html',
  styleUrl: './dashboard-invoices-chart.component.css',
})
export class DashboardInvoicesChartComponent implements OnInit, AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(DashboardInvoicesStore);

  @ViewChild('chartTrack') private chartTrackRef?: ElementRef<HTMLElement>;
  @ViewChildren('barBox') private barBoxes?: QueryList<ElementRef<HTMLElement>>;

  readonly loading = this.store.loading;
  readonly error = this.store.error;
  readonly isEmpty = this.store.isEmpty;

  readonly bars = this.store.monthlyRevenue;

  readonly totalLabel = computed(() =>
    formatCents(this.store.chartTotalCents(), this.store.currency()),
  );

  /** Delta real mes contra mes; null cuando no se puede calcular. */
  readonly growthPercent = this.store.monthOverMonthPercent;

  readonly growthLabel = computed(() => {
    const percent = this.growthPercent();
    return percent === null ? '' : `${percent > 0 ? '+' : ''}${percent}%`;
  });

  readonly summary = computed<SummaryItem[]>(() => {
    const currency = this.store.currency();
    return [
      {
        // Explícito: el titular es de 6 meses, esta cifra es de siempre.
        label: 'All-time collected',
        value: formatCents(this.store.collectedAllTimeCents(), currency),
        dot: 'bg-emerald-600',
      },
      {
        label: 'Outstanding',
        value: formatCents(this.store.outstandingCents(), currency),
        dot: 'bg-orange-500',
      },
      {
        label: 'Drafts',
        value: this.store.draftCount().toLocaleString('en-US'),
        dot: 'bg-gray-300',
      },
    ];
  });

  /** Índice de la barra con el tooltip visible; "sticky" en la última con hover. */
  readonly hoveredIndex = signal<number | null>(null);

  private readonly maxCents = computed(() =>
    Math.max(...this.bars().map(b => b.paidCents), 1),
  );

  /** Por defecto, el mes con más ingresos de los 6 (el último índice si todos son 0). */
  private readonly highestIndex = computed(() =>
    this.bars().reduce(
      (best, bar, index, all) => (bar.paidCents > all[best].paidCents ? index : best),
      0,
    ),
  );

  readonly tooltipIndex = computed<number>(() => this.hoveredIndex() ?? this.highestIndex());
  readonly tooltipBar = computed<MonthlyRevenueBucket | null>(
    () => this.bars()[this.tooltipIndex()] ?? null,
  );

  /** Posición del tooltip deslizante, en px relativos a #chartTrack. */
  readonly tooltipLeft = signal(0);
  readonly tooltipTop = signal(0);
  readonly tooltipReady = signal(false);

  ngOnInit(): void {
    this.store.load();
  }

  ngAfterViewInit(): void {
    this.syncTooltipPosition();
    // Las barras se montan recién cuando llega la respuesta del backend:
    // re-medir en cuanto el *ngFor las cree.
    this.barBoxes?.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      setTimeout(() => this.syncTooltipPosition());
    });
  }

  barHeight(bar: MonthlyRevenueBucket): number {
    return Math.round((bar.paidCents / this.maxCents()) * 100);
  }

  /** Mes en curso resaltado; meses sin cobros con el tope apagado. */
  barStyleClass(bar: MonthlyRevenueBucket, index: number): string {
    if (bar.paidCents <= 0) {
      return 'revenue-bar--empty';
    }
    return index === this.bars().length - 1 ? 'revenue-bar--vivid' : 'revenue-bar--light';
  }

  tooltipLabel(bar: MonthlyRevenueBucket): string {
    return formatCents(bar.paidCents, this.store.currency());
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
