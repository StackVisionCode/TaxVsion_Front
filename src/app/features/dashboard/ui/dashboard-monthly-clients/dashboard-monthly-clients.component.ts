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
import { CustomerSummary } from '../../../clients/data-access/clients.model';
import {
  DashboardClientsStore,
  MonthlyClientsBucket,
} from '../../data-access/dashboard-clients.store';
import { DashboardWidgetStateComponent } from '../dashboard-widget-state/dashboard-widget-state.component';

/** Color de la barra del mes en curso y de los meses anteriores (azul de marca). */
const CURRENT_MONTH_COLOR = 'rgb(var(--color-indigo-600-rgb, 30 70 107))';
const PAST_MONTH_COLOR = '#D7E3EF';

/**
 * Widget "New Clients".
 *
 * Antes: 23 clientes nuevos, "+12% vs last month", un mini gráfico de 6 meses
 * con conteos inventados y tres "Recent additions" con nombres y facturación
 * ("Olivia Martin · $9,800") que no existen en ningún sitio.
 *
 * Ahora sale del {@link DashboardClientsStore} (`GET /customers`, compartido
 * con el hero — una sola petición para los dos):
 *  - El titular es el conteo de altas del mes en curso, calculado sobre
 *    `createdAtUtc` real.
 *  - El delta se calcula contra el mes anterior y se OCULTA si ese mes fue 0.
 *  - "Recent additions" son los clientes creados más recientemente, con su
 *    tipo real (Individual/Business) y su fecha de alta. Se quitó la columna
 *    de facturación: no existe ingreso por cliente en ningún endpoint.
 *
 * Salvedad honesta: `/customers` ordena por nombre y no admite filtro por
 * fecha, así que el desglose mensual solo se pinta cuando se pudo traer la
 * lista COMPLETA del tenant (ver `hasFullHistory`). Si hay más clientes que
 * el tamaño de página, se muestra el total exacto del servidor y se avisa de
 * que el desglose no está disponible, en vez de graficar una muestra parcial
 * como si fuera el total.
 */
@Component({
  selector: 'app-dashboard-monthly-clients',
  imports: [CommonModule, DashboardWidgetStateComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-monthly-clients.component.html',
  styleUrl: './dashboard-monthly-clients.component.css',
})
export class DashboardMonthlyClientsComponent implements OnInit, AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(DashboardClientsStore);

  @ViewChild('chartTrack') private chartTrackRef?: ElementRef<HTMLElement>;
  @ViewChildren('barBox') private barBoxes?: QueryList<ElementRef<HTMLElement>>;

  readonly loading = this.store.loading;
  readonly error = this.store.error;
  readonly totalCount = this.store.totalCount;
  readonly hasFullHistory = this.store.hasFullHistory;

  readonly months = this.store.monthlyClients;
  readonly currentMonthCount = this.store.newThisMonth;
  readonly deltaPercent = this.store.monthOverMonthPercent;
  readonly recentClients = this.store.recentCustomers;

  readonly deltaLabel = computed(() => {
    const percent = this.deltaPercent();
    return percent === null ? '' : `${percent > 0 ? '+' : ''}${percent}% vs last month`;
  });

  /** Sin ningún cliente todavía: estado vacío, no un cero grande sin contexto. */
  readonly isEmpty = computed(() => !this.loading() && !this.error() && this.totalCount() === 0);

  private readonly maxCount = computed(() => Math.max(...this.months().map(m => m.count), 1));
  private readonly defaultIndex = computed(() => this.months().length - 1);

  /** Índice de la barra con tooltip visible; "sticky" en la última con hover. */
  readonly hoveredIndex = signal<number | null>(null);
  readonly tooltipIndex = computed<number>(() => this.hoveredIndex() ?? this.defaultIndex());
  readonly tooltipMonth = computed<MonthlyClientsBucket | null>(
    () => this.months()[this.tooltipIndex()] ?? null,
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
    // Las barras aparecen recién cuando responde el backend: re-medir entonces.
    this.barBoxes?.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      setTimeout(() => this.syncTooltipPosition());
    });
  }

  barHeight(month: MonthlyClientsBucket): number {
    return Math.round((month.count / this.maxCount()) * 100);
  }

  barColor(index: number): string {
    return index === this.months().length - 1 ? CURRENT_MONTH_COLOR : PAST_MONTH_COLOR;
  }

  tooltipLabel(month: MonthlyClientsBucket): string {
    return `${month.count} client${month.count === 1 ? '' : 's'}`;
  }

  trackByClientId(_index: number, client: CustomerSummary): string {
    return client.id;
  }

  initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return '?';
    }
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  avatarBg(index: number): string {
    return index % 2 === 0 ? 'bg-brand-bold' : 'bg-indigo-600';
  }

  typeChipClass(kind: string): string {
    return kind === 'Business' ? 'border-indigo-200 text-indigo-600' : 'border-gray-200 text-gray-500';
  }

  createdLabel(client: CustomerSummary): string {
    const date = new Date(client.createdAtUtc);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
    const box = this.barBoxes?.toArray()[this.tooltipIndex()]?.nativeElement;
    if (!container || !box) {
      this.tooltipReady.set(false);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();

    this.tooltipLeft.set(boxRect.left - containerRect.left + boxRect.width / 2);
    this.tooltipTop.set(boxRect.top - containerRect.top);
    this.tooltipReady.set(true);
  }
}
