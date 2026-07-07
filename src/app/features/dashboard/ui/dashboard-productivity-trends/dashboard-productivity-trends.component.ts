import { Component, CUSTOM_ELEMENTS_SCHEMA, HostListener, computed, signal } from '@angular/core';
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
 * con tooltip negro que sigue el hover, jueves con patrón rayado, y dropdown
 * Week/Month funcional que intercambia datasets estáticos. Sin backend.
 */
@Component({
  selector: 'app-dashboard-productivity-trends',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-productivity-trends.component.html',
  styleUrl: './dashboard-productivity-trends.component.css',
})
export class DashboardProductivityTrendsComponent {
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

  /** Índice de la barra con tooltip visible; por defecto la primera con datos. */
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
    if (hovered !== null && this.bars()[hovered]?.hours > 0) {
      return hovered;
    }
    const firstWithData = this.bars().findIndex(b => b.hours > 0);
    return firstWithData === -1 ? null : firstWithData;
  });

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
    this.hoveredIndex.set(index);
  }

  onBarLeave(): void {
    this.hoveredIndex.set(null);
  }
}
