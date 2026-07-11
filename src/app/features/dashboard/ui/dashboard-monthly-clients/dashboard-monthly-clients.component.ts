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
 * last 6 months with a black pill tooltip that SLIDES with the hover and
 * stays "sticky" on the last hovered month (same pattern as Productivity
 * Trends / Monthly Revenue: a single persistent element, position measured
 * via getBoundingClientRect — not mounted/unmounted per bar), and a short
 * "Recent additions" list. Static data, no backend.
 */
@Component({
  selector: 'app-dashboard-monthly-clients',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-monthly-clients.component.html',
  styleUrl: './dashboard-monthly-clients.component.css',
})
export class DashboardMonthlyClientsComponent implements AfterViewInit {
  @ViewChild('chartTrack') private chartTrackRef?: ElementRef<HTMLElement>;
  @ViewChildren('barBox') private barBoxes?: QueryList<ElementRef<HTMLElement>>;

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
  /** Último mes (el resaltado en color vivid) hasta el primer hover. */
  private readonly defaultIndex = this.months.length - 1;

  /** Índice de la barra con tooltip visible; "sticky" — se queda en la
   *  última barra con la que se hizo hover, no vuelve al mes por defecto
   *  al sacar el mouse. */
  readonly hoveredIndex = signal<number | null>(null);
  readonly tooltipIndex = computed<number>(() => this.hoveredIndex() ?? this.defaultIndex);
  readonly tooltipMonth = computed<MonthBar>(() => this.months[this.tooltipIndex()]);

  /** Posición del tooltip deslizante, en px relativos a #chartTrack (no %: inmune a gaps/padding). */
  readonly tooltipLeft = signal(0);
  readonly tooltipTop = signal(0);
  readonly tooltipReady = signal(false);

  ngAfterViewInit(): void {
    this.syncTooltipPosition();
  }

  barHeight(month: MonthBar): number {
    return Math.round((month.count / this.maxCount) * 100);
  }

  tooltipLabel(month: MonthBar): string {
    return `${month.count} client${month.count === 1 ? '' : 's'}`;
  }

  typeChipClass(type: ClientType): string {
    return type === 'Business'
      ? 'border-indigo-200 text-indigo-600'
      : 'border-gray-200 text-gray-500';
  }

  onBarEnter(index: number): void {
    this.hoveredIndex.set(index);
    this.syncTooltipPosition();
  }

  /**
   * Mide la posición real de la barra activa (getBoundingClientRect, no
   * porcentajes del CSS) para que el tooltip se deslice con precisión sin
   * importar anchos/gaps del flex — mismo patrón que el pill del sidebar.
   * #barBox va directo sobre la barra (no hay variante "vacía" como en
   * Productivity Trends), así que su borde superior YA es el punto exacto.
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
