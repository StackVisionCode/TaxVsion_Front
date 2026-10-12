import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { TaskStore } from '../../../task/data-access/task.store';
import { MeetingsStore } from '../../../meetings/data-access/meetings.store';
import { DashboardCalendarService } from '../../data-access/calendar.service';
import { CalendarEvent } from '../../data-access/calendar.model';
import { AgendaItem, AgendaKind, buildAgenda } from '../../utils/dashboard-insights.util';

const TASKS: AccessRequirement = { module: 'planner', anyOf: ['tasks.read'] };
const CALENDAR: AccessRequirement = { module: 'planner', anyOf: ['calendar.read'] };
const MEETINGS: AccessRequirement = {
  module: 'meetings',
  anyOf: ['communication.meeting.create', 'communication.meeting.join'],
};

const MAX_ROWS = 6;

const KIND_ICON: Record<AgendaKind, { icon: string; circle: string }> = {
  task: { icon: 'checkbox-outline', circle: 'bg-sand-600 text-white' },
  appointment: { icon: 'calendar-outline', circle: 'bg-sage-600 text-white' },
  meeting: { icon: 'videocam-outline', circle: 'bg-brand-bold text-white' },
};

/**
 * Widget "Today": la agenda del día en una sola línea de tiempo, como el "Today" de Salesforce o el
 * "My work" de Karbon. Junta tres fuentes reales, cada una solo si el usuario tiene acceso:
 *  - tareas abiertas que vencen HOY (día local) — {@link TaskStore}, compartido con el hero;
 *  - citas del calendario de hoy — `GET /calendar/appointments?from=&to=` (una petición chica);
 *  - reuniones en vivo o agendadas para hoy — {@link MeetingsStore}, compartido con Video Calls.
 *
 * Una fuente que falla no tumba el widget: se muestra lo que sí llegó.
 */
@Component({
  selector: 'app-dashboard-today',
  imports: [CommonModule, RouterLink, StateBlockComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-today.component.html',
})
export class DashboardTodayComponent implements OnInit {
  private readonly access = inject(AccessStore);
  private readonly tasks = inject(TaskStore);
  private readonly meetings = inject(MeetingsStore);
  private readonly calendar = inject(DashboardCalendarService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly appointments = signal<CalendarEvent[]>([]);
  private readonly appointmentsLoading = signal(false);
  private readonly now = signal(new Date());

  private readonly useTasks = this.access.canUse(TASKS);
  private readonly useCalendar = this.access.canUse(CALENDAR);
  private readonly useMeetings = this.access.canUse(MEETINGS);

  readonly loading = computed(
    () =>
      (this.useTasks && this.tasks.loading()) ||
      (this.useMeetings && this.meetings.loading()) ||
      this.appointmentsLoading(),
  );

  /** Con filtros activos en /task, `tasks()` son resultados de búsqueda: no sirven como agenda. */
  readonly tasksFiltered = computed(() => this.useTasks && this.tasks.isSearching());

  private readonly agenda = computed<AgendaItem[]>(() =>
    buildAgenda(
      {
        tasks: this.useTasks && !this.tasksFiltered() ? this.tasks.tasks() : [],
        appointments: this.appointments(),
        meetings: this.useMeetings ? this.meetings.upcoming() : [],
      },
      this.now(),
    ),
  );

  readonly rows = computed(() => this.agenda().slice(0, MAX_ROWS));
  readonly hiddenCount = computed(() => Math.max(0, this.agenda().length - MAX_ROWS));
  readonly total = computed(() => this.agenda().length);

  ngOnInit(): void {
    if (this.useTasks) {
      this.tasks.init();
    }
    if (this.useMeetings) {
      this.meetings.loadScope('upcoming');
    }
    if (this.useCalendar) {
      this.loadAppointments();
    }

    const timer = setInterval(() => this.now.set(new Date()), 60_000);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  kindStyle(kind: AgendaKind): { icon: string; circle: string } {
    return KIND_ICON[kind];
  }

  timeLabel(item: AgendaItem): string {
    if (item.live) {
      return 'Now';
    }
    if (!item.time) {
      return 'All day';
    }
    return item.time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  private loadAppointments(): void {
    const today = this.now();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    this.appointmentsLoading.set(true);
    this.calendar.range(start, end).subscribe({
      next: events => {
        this.appointments.set(events);
        this.appointmentsLoading.set(false);
      },
      error: () => this.appointmentsLoading.set(false),
    });
  }
}
