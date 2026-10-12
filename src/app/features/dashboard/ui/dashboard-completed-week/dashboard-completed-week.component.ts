import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CountUpDirective } from '@shared/directives/count-up.directive';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { TaskStore } from '../../../task/data-access/task.store';
import { CompletedWeek, DayBucket, completedLast7Days } from '../../utils/dashboard-insights.util';

/** Alto mínimo de una barra con al menos 1 tarea, para que no se confunda con un día vacío. */
const MIN_BAR_PERCENT = 12;

/**
 * Widget "Completed this week": tareas completadas por día en los últimos 7 días (día local), como las
 * barras de actividad de Pipedrive o el throughput de Karbon.
 *
 * Antes ocupaba este lugar "Productivity Trends" con un estado vacío: la plataforma no tiene time
 * tracking. Las completadas SÍ son reales: salen de `completedAtUtc` de las tareas que el
 * {@link TaskStore} ya trae (`/tasks/search?status=Completed`, las 50 más recientes). Si ese tope cae
 * entero dentro de la semana, el total es un mínimo y la tarjeta lo dice.
 */
@Component({
  selector: 'app-dashboard-completed-week',
  imports: [CommonModule, RouterLink, CountUpDirective, StateBlockComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-completed-week.component.html',
  styleUrl: './dashboard-completed-week.component.css',
})
export class DashboardCompletedWeekComponent implements OnInit {
  private readonly store = inject(TaskStore);

  readonly loading = this.store.loading;
  readonly error = this.store.error;
  readonly filtered = this.store.isSearching;

  readonly week = computed<CompletedWeek>(() => completedLast7Days(this.store.tasks(), new Date()));

  ngOnInit(): void {
    this.store.init();
  }

  retry(): void {
    this.store.refresh();
  }

  barHeight(bucket: DayBucket): number {
    const max = this.week().max;
    if (bucket.count === 0 || max === 0) {
      return 0;
    }
    return Math.max(MIN_BAR_PERCENT, Math.round((bucket.count / max) * 100));
  }

  barClass(index: number, bucket: DayBucket): string {
    if (bucket.count === 0) {
      return 'trend-bar--striped';
    }
    return index === this.week().buckets.length - 1 ? 'trend-bar--vivid' : 'trend-bar--light';
  }
}
