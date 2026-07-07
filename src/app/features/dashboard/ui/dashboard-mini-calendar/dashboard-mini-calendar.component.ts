import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
}

interface CalendarDay {
  date: Date;
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  hasEvents: boolean;
}

/** Date at a fixed day of the *current* real month. */
function onDayOfMonth(dayOfMonth: number, hour = 10): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), dayOfMonth, hour, 0, 0, 0);
}

/** Date relative to today, so "Today" always has activity on first load. */
function inDays(days: number, hour = 10): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

/** Static, realistic-looking mix of appointments and task deadlines. */
const MOCK_EVENTS: CalendarEvent[] = [
  { id: 'evt-1', title: 'Client Consultation — Maria Gonzalez', date: inDays(0, 9) },
  { id: 'evt-2', title: 'Team Meeting — Weekly Sync', date: inDays(0, 11) },
  { id: 'evt-3', title: 'Submit W-2 Corrections', date: inDays(0, 17) },
  { id: 'evt-4', title: 'Tax Review — Johnson LLC', date: onDayOfMonth(3, 14) },
  { id: 'evt-5', title: 'Phone Call — David Chen', date: onDayOfMonth(8, 11) },
  { id: 'evt-6', title: 'On-Site Visit — Riverside Bakery', date: onDayOfMonth(15, 13) },
  { id: 'evt-7', title: 'File Extension Request', date: onDayOfMonth(21, 12) },
  { id: 'evt-8', title: 'Follow-up — Estate Planning Docs', date: onDayOfMonth(26, 15) },
];

/**
 * Widget "Calendar" (referencia "Aether"): mini calendario mensual con
 * navegación real prev/next, hoy como píldora negra, punto púrpura en días
 * con eventos y chips de resumen (Today / Upcoming). Datos estáticos.
 */
@Component({
  selector: 'app-dashboard-mini-calendar',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-mini-calendar.component.html',
})
export class DashboardMiniCalendarComponent {
  readonly weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  private readonly events = signal<CalendarEvent[]>(MOCK_EVENTS);

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

  prevMonth(): void {
    const current = this.currentDate();
    this.currentDate.set(new Date(current.getFullYear(), current.getMonth() - 1, 1));
  }

  nextMonth(): void {
    const current = this.currentDate();
    this.currentDate.set(new Date(current.getFullYear(), current.getMonth() + 1, 1));
  }

  dayClass(day: CalendarDay): string {
    if (day.isToday) {
      return 'bg-gray-900 font-semibold text-white';
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
