import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  OnInit,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TaskService } from '../../data-access/task.service';
import { ApiTaskPriority, TaskCalendarEntry } from '../../data-access/task.model';
import { priorityChipClass } from '@core/tasks/task-format';

interface CalendarDay {
  date: Date;
  iso: string; // YYYY-MM-DD
  inMonth: boolean;
  isToday: boolean;
  entries: TaskCalendarEntry[];
}

/**
 * Vista Calendario del módulo Task: grilla mensual con las tareas por `dueAtUtc`, resaltando
 * estatutarias y vencidas. Self-contained (fetch propio de `GET /tasks/calendar` por rango de mes,
 * read-only). Al hacer click en una tarea emite la entrada; la página abre el drawer.
 *
 * ⚠️ Fechas: el backend da UTC + TimeZoneId; aquí se agrupa por el día del `dueAtUtc` (slice ISO).
 */
@Component({
  selector: 'app-task-calendar',
  standalone: true,
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './task-calendar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskCalendarComponent implements OnInit {
  private readonly service = inject(TaskService);

  @Output() taskOpened = new EventEmitter<TaskCalendarEntry>();

  readonly anchor = signal(startOfMonth(new Date()));
  readonly entries = signal<TaskCalendarEntry[]>([]);
  readonly loading = signal(false);

  readonly monthLabel = computed(() =>
    this.anchor().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  );

  readonly weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  readonly weeks = computed<CalendarDay[][]>(() => {
    const first = this.anchor();
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - first.getDay()); // retrocede al domingo
    const byDay = new Map<string, TaskCalendarEntry[]>();
    for (const e of this.entries()) {
      const iso = e.dueAtUtc.slice(0, 10);
      const arr = byDay.get(iso) ?? [];
      arr.push(e);
      byDay.set(iso, arr);
    }
    const todayIso = isoOf(new Date());
    const weeks: CalendarDay[][] = [];
    const cursor = new Date(gridStart);
    for (let w = 0; w < 6; w++) {
      const week: CalendarDay[] = [];
      for (let d = 0; d < 7; d++) {
        const iso = isoOf(cursor);
        week.push({
          date: new Date(cursor),
          iso,
          inMonth: cursor.getMonth() === first.getMonth(),
          isToday: iso === todayIso,
          entries: byDay.get(iso) ?? [],
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    return weeks;
  });

  ngOnInit(): void {
    this.load();
  }

  prevMonth(): void {
    const a = this.anchor();
    this.anchor.set(new Date(a.getFullYear(), a.getMonth() - 1, 1));
    this.load();
  }

  nextMonth(): void {
    const a = this.anchor();
    this.anchor.set(new Date(a.getFullYear(), a.getMonth() + 1, 1));
    this.load();
  }

  today(): void {
    this.anchor.set(startOfMonth(new Date()));
    this.load();
  }

  private load(): void {
    // Rango: cubre la grilla visible (6 semanas desde el domingo previo al 1º).
    const first = this.anchor();
    const from = new Date(first);
    from.setDate(first.getDate() - first.getDay());
    const to = new Date(from);
    to.setDate(from.getDate() + 42);
    this.loading.set(true);
    this.service.calendar(from.toISOString(), to.toISOString()).subscribe({
      next: entries => {
        this.entries.set(entries);
        this.loading.set(false);
      },
      error: () => {
        this.entries.set([]);
        this.loading.set(false);
      },
    });
  }

  open(entry: TaskCalendarEntry): void {
    this.taskOpened.emit(entry);
  }

  isOverdue(entry: TaskCalendarEntry): boolean {
    return (
      entry.status !== 'Completed' &&
      entry.status !== 'Cancelled' &&
      new Date(entry.dueAtUtc).getTime() < Date.now()
    );
  }

  priorityDot(priority: ApiTaskPriority): string {
    switch (priority) {
      case 'Urgent':
        return 'bg-red-500';
      case 'High':
        return 'bg-orange-500';
      case 'Normal':
        return 'bg-amber-500';
      case 'Low':
        return 'bg-emerald-500';
    }
  }

  // Expuesto por si el template lo necesita para chips.
  priorityChip = priorityChipClass;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function isoOf(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
