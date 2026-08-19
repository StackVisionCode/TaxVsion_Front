import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  HostListener,
  QueryList,
  ViewChild,
  ViewChildren,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';

interface TrendBar {
  label: string;
  hours: number;
  /** Clase de color de la barra; 'striped' usa el patrón de rayas diagonales. */
  style: 'light' | 'lighter' | 'vivid' | 'medium' | 'striped' | 'empty';
}

type TrendRange = 'Week' | 'Month';

/**
 * Widget "Productivity Trends" (referencia "Aether"): gráfico de barras píldora
 * con tooltip negro que se DESLIZA con el hover (un solo elemento persistente,
 * posición medida vía getBoundingClientRect — mismo patrón que el pill
 * deslizante del sidebar — en vez de destruir/crear un tooltip por barra, que
 * hacía que "saltara" de una posición a otra), jueves con patrón rayado, y
 * dropdown Week/Month funcional que intercambia datasets estáticos. Sin backend.
 */
@Component({
  selector: 'app-dashboard-productivity-trends',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-productivity-trends.component.html',
  styleUrl: './dashboard-productivity-trends.component.css',
})
export class DashboardProductivityTrendsComponent implements AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('chartTrack') private chartTrackRef?: ElementRef<HTMLElement>;
  @ViewChildren('barBox') private barBoxes?: QueryList<ElementRef<HTMLElement>>;

  private static readonly WEEK_DATA: TrendBar[] = [
    { label: 'Sun', hours: 0, style: 'empty' },
    { label: 'Mon', hours: 4, style: 'light' },
    { label: 'Tue', hours: 2.5, style: 'lighter' },
    { label: 'Wed', hours: 5.5, style: 'vivid' },
    { label: 'Thu', hours: 5, style: 'striped' },
    { label: 'Fri', hours: 4.5, style: 'medium' },
    { label: 'Sat', hours: 0, style: 'empty' },
  ];

  private static readonly MONTH_DATA: TrendBar[] = [
    { label: 'W1', hours: 18, style: 'light' },
    { label: 'W2', hours: 12, style: 'lighter' },
    { label: 'W3', hours: 24, style: 'vivid' },
    { label: 'W4', hours: 21, style: 'striped' },
  ];

  readonly range = signal<TrendRange>('Week');
  readonly isRangeOpen = signal(false);
  readonly ranges: TrendRange[] = ['Week', 'Month'];

  /** Índice de la barra con tooltip visible; "sticky" — se queda en la última
   *  barra con datos que se hizo hover, no vuelve a la de por defecto al
   *  sacar el mouse. Por defecto la primera con datos. */
  readonly hoveredIndex = signal<number | null>(null);

  readonly bars = computed<TrendBar[]>(() =>
    this.range() === 'Week'
      ? DashboardProductivityTrendsComponent.WEEK_DATA
      : DashboardProductivityTrendsComponent.MONTH_DATA,
  );

  readonly maxHours = computed(() => Math.max(...this.bars().map(b => b.hours), 1));

  readonly summary = computed(() =>
    this.range() === 'Week'
      ? { total: '14 h', caption: 'logged this week', delta: '+15% vs last week' }
      : { total: '75 h', caption: 'logged this month', delta: '+9% vs last month' },
  );

  readonly tooltipIndex = computed<number | null>(() => {
    const hovered = this.hoveredIndex();
    if (hovered !== null) {
      return hovered;
    }
    const firstWithData = this.bars().findIndex(b => b.hours > 0);
    return firstWithData === -1 ? null : firstWithData;
  });

  readonly tooltipBar = computed<TrendBar | null>(() => {
    const i = this.tooltipIndex();
    return i === null ? null : (this.bars()[i] ?? null);
  });

  /** Posición del tooltip deslizante, en px relativos a #chartTrack (no %: inmune a gaps/padding). */
  readonly tooltipLeft = signal(0);
  readonly tooltipTop = signal(0);
  readonly tooltipReady = signal(false);

  ngAfterViewInit(): void {
    this.syncTooltipPosition();
    // El *ngFor recrea las barras al cambiar de rango (Week/Month): re-medir
    // una vez que el nuevo set de #barBox termine de renderizar.
    this.barBoxes?.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      setTimeout(() => this.syncTooltipPosition());
    });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="trend-range"]') && this.isRangeOpen()) {
      this.isRangeOpen.set(false);
    }
  }

  toggleRangeDropdown(): void {
    this.isRangeOpen.update(open => !open);
  }

  selectRange(range: TrendRange): void {
    this.range.set(range);
    this.isRangeOpen.set(false);
    this.hoveredIndex.set(null);
  }

  barHeight(bar: TrendBar): number {
    return Math.round((bar.hours / this.maxHours()) * 100);
  }

  tooltipLabel(bar: TrendBar): string {
    return `${bar.hours} hour${bar.hours === 1 ? '' : 's'}`;
  }

  onBarEnter(index: number): void {
    // Días vacíos (Sun/Sat) no tienen datos que mostrar: se ignoran y el
    // tooltip se queda pegado en la última barra válida.
    if ((this.bars()[index]?.hours ?? 0) <= 0) {
      return;
    }
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
    if (!container || !boxes?.length || index === null || !bar) {
      this.tooltipReady.set(false);
      return;
    }
    const box = boxes[index]?.nativeElement;
    if (!box) {
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
