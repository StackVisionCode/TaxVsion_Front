import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarEvent } from '../../data-access/calendar.model';
import { DashboardCalendarService } from '../../data-access/calendar.service';

interface CalendarDay {
  date: Date;
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  hasEvents: boolean;
}

/**
 * Widget "Calendar" (referencia "Aether"): mini calendario mensual con navegación
 * real prev/next, hoy como píldora negra, punto púrpura en días con citas y chips
 * de resumen (Today / Upcoming).
 *
 * Conectado a Calendar.Api: cada cambio de mes pide el rango visible completo (las
 * 6 semanas de la grilla, no solo el mes) para que los días de relleno también
 * muestren su punto. Sin permiso `calendar.read` la llamada falla y el widget se
 * queda vacío en silencio: es un accesorio del dashboard, no debe romperlo.
 */
@Component({
  selector: 'app-dashboard-mini-calendar',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-mini-calendar.component.html',
})
export class DashboardMiniCalendarComponent implements OnInit {
  private readonly service = inject(DashboardCalendarService);

  readonly weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  private readonly events = signal<CalendarEvent[]>([]);
  readonly loading = signal(false);

  readonly currentDate = signal(new Date());

  readonly monthLabel = computed(() =>
    this.currentDate().toLocaleString('en-US', { month: 'long', year: 'numeric' }),
  );

  readonly calendarDays = computed<CalendarDay[]>(() =>
    this.generateCalendar(this.currentDate(), this.events()),
  );

  readonly todayCount = computed(() => {
    const today = new Date();
    return this.events().filter(event => this.isSameDay(event.date, today)).length;
  });

  readonly upcomingCount = computed(
    () => this.events().filter(event => event.date.getTime() > Date.now()).length,
  );

  ngOnInit(): void {
    this.loadMonth();
  }

  prevMonth(): void {
    const current = this.currentDate();
    this.currentDate.set(new Date(current.getFullYear(), current.getMonth() - 1, 1));
    this.loadMonth();
  }

  nextMonth(): void {
    const current = this.currentDate();
    this.currentDate.set(new Date(current.getFullYear(), current.getMonth() + 1, 1));
    this.loadMonth();
  }

  /** Trae el rango visible completo (las 6 semanas de la grilla), no solo el mes. */
  private loadMonth(): void {
    const days = this.calendarDays();
    const from = new Date(days[0].date);
    from.setHours(0, 0, 0, 0);
    const to = new Date(days[days.length - 1].date);
    to.setHours(23, 59, 59, 999);

    this.loading.set(true);
    this.service.range(from, to).subscribe({
      next: events => {
        this.events.set(events);
        this.loading.set(false);
      },
      error: () => {
        // Accesorio del dashboard: sin permiso calendar.read se queda vacío, sin romper nada.
        this.events.set([]);
        this.loading.set(false);
      },
    });
  }

  dayClass(day: CalendarDay): string {
    if (day.isToday) {
      return 'bg-brand-bold font-semibold text-white';
    }
    if (!day.isCurrentMonth) {
      return 'text-gray-300';
    }
    return 'text-gray-700 hover:bg-gray-100';
  }

  private generateCalendar(currentDate: Date, events: CalendarEvent[]): CalendarDay[] {
    const days: CalendarDay[] = [];
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      days.push(this.createDay(new Date(year, month - 1, prevMonthLastDay - i), false, events));
    }
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(this.createDay(new Date(year, month, day), true, events));
    }
    const remaining = 42 - days.length;
    for (let day = 1; day <= remaining; day++) {
      days.push(this.createDay(new Date(year, month + 1, day), false, events));
    }

    return days;
  }

  private createDay(date: Date, isCurrentMonth: boolean, events: CalendarEvent[]): CalendarDay {
    return {
      date,
      day: date.getDate(),
      isCurrentMonth,
      isToday: this.isSameDay(date, new Date()),
      hasEvents: events.some(event => this.isSameDay(event.date, date)),
    };
  }

  private isSameDay(a: Date, b: Date): boolean {
    return (
      a.getDate() === b.getDate() &&
      a.getMonth() === b.getMonth() &&
      a.getFullYear() === b.getFullYear()
    );
  }
}
