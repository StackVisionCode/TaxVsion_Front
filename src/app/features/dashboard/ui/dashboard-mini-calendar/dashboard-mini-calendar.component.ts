import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Trimmed-down, local re-implementation of the appointment/task calendar
 * types from the production CRM's `calendar-api.interfaces.ts`. Only the
 * shapes and helpers actually consumed by the mini-calendar widget and the
 * appointment-creation modal are kept. Shared with
 * `appointment-modal.component.ts` via a relative import so both widgets
 * agree on the same `AppointmentTypeConfig` list.
 */
export type CalendarEventKind = 'appointment' | 'task';

export interface CalendarEventData {
  id: string;
  title: string;
  start: Date;
  end: Date;
  color: string;
  type: CalendarEventKind;
  status: string;
  description?: string;
  location?: string | null;
  /** Appointment type id — see APPOINTMENT_TYPE_CONFIGS. Only set when type === 'appointment'. */
  typeId?: number;
  /** Task priority id — see TASK_PRIORITY_CONFIGS. Only set when type === 'task'. */
  priorityId?: number;
}

export interface AppointmentTypeConfig {
  id: number;
  label: string;
  icon: string;
  color: string;
}

export const APPOINTMENT_TYPE_CONFIGS: AppointmentTypeConfig[] = [
  { id: 1, label: 'Consultation', icon: 'people-outline', color: '#3B82F6' },
  { id: 2, label: 'Tax Review', icon: 'document-text-outline', color: '#8B5CF6' },
  { id: 3, label: 'Meeting', icon: 'calendar-outline', color: '#10B981' },
  { id: 4, label: 'Phone Call', icon: 'call-outline', color: '#F59E0B' },
  { id: 5, label: 'Video Call', icon: 'videocam-outline', color: '#EF4444' },
  { id: 6, label: 'On-Site', icon: 'location-outline', color: '#06B6D4' },
  { id: 7, label: 'Other', icon: 'ellipsis-horizontal-outline', color: '#6B7280' },
];

export function getAppointmentTypeConfig(typeId: number): AppointmentTypeConfig {
  return APPOINTMENT_TYPE_CONFIGS.find(c => c.id === typeId) ?? APPOINTMENT_TYPE_CONFIGS[APPOINTMENT_TYPE_CONFIGS.length - 1];
}

export interface TaskPriorityConfig {
  id: number;
  label: string;
  color: string;
  icon: string;
}

export const TASK_PRIORITY_CONFIGS: TaskPriorityConfig[] = [
  { id: 1, label: 'Low', color: '#10B981', icon: 'arrow-down-outline' },
  { id: 2, label: 'Medium', color: '#F59E0B', icon: 'remove-outline' },
  { id: 3, label: 'High', color: '#EF4444', icon: 'arrow-up-outline' },
  { id: 4, label: 'Urgent', color: '#DC2626', icon: 'warning-outline' },
];

export function getTaskPriorityConfig(priorityId: number): TaskPriorityConfig {
  return TASK_PRIORITY_CONFIGS.find(c => c.id === priorityId) ?? TASK_PRIORITY_CONFIGS[0];
}

interface CalendarDay {
  date: Date;
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  hasEvents: boolean;
  eventsCount: number;
  events: CalendarEventData[];
}

/** Builds a Date within the *current* real month, so the mock data always shows up on first load. */
function dayInCurrentMonth(dayOfMonth: number, hour: number, minute: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), dayOfMonth, hour, minute, 0, 0);
}

/** Static, realistic-looking mix of appointments and task deadlines for the current month. */
function buildMockEvents(): CalendarEventData[] {
  const today = new Date().getDate();

  return [
    {
      id: 'evt-1',
      title: 'Client Consultation — Maria Gonzalez',
      start: dayInCurrentMonth(today, 9, 0),
      end: dayInCurrentMonth(today, 10, 0),
      color: getAppointmentTypeConfig(1).color,
      type: 'appointment',
      status: 'Scheduled',
      typeId: 1,
      description: 'Initial consultation to review tax filing needs.',
      location: 'Office — Room 2',
    },
    {
      id: 'evt-2',
      title: 'Submit W-2 Corrections',
      start: dayInCurrentMonth(today, 17, 0),
      end: dayInCurrentMonth(today, 17, 0),
      color: getTaskPriorityConfig(4).color,
      type: 'task',
      status: 'InProgress',
      priorityId: 4,
      description: 'Urgent: correct and resubmit W-2 forms before the deadline.',
    },
    {
      id: 'evt-3',
      title: 'Tax Review — Johnson LLC',
      start: dayInCurrentMonth(3, 14, 30),
      end: dayInCurrentMonth(3, 15, 30),
      color: getAppointmentTypeConfig(2).color,
      type: 'appointment',
      status: 'Confirmed',
      typeId: 2,
      description: 'Quarterly tax review for Johnson LLC.',
    },
    {
      id: 'evt-4',
      title: 'Team Meeting — Weekly Sync',
      start: dayInCurrentMonth(5, 10, 0),
      end: dayInCurrentMonth(5, 10, 30),
      color: getAppointmentTypeConfig(3).color,
      type: 'appointment',
      status: 'Scheduled',
      typeId: 3,
      location: 'Conference Room A',
    },
    {
      id: 'evt-5',
      title: 'Phone Call — David Chen',
      start: dayInCurrentMonth(8, 11, 15),
      end: dayInCurrentMonth(8, 11, 45),
      color: getAppointmentTypeConfig(4).color,
      type: 'appointment',
      status: 'Scheduled',
      typeId: 4,
    },
    {
      id: 'evt-6',
      title: 'Prepare Quarterly Report',
      start: dayInCurrentMonth(10, 16, 0),
      end: dayInCurrentMonth(10, 16, 0),
      color: getTaskPriorityConfig(3).color,
      type: 'task',
      status: 'NotStarted',
      priorityId: 3,
      description: 'Compile Q2 financial summaries for partner review.',
    },
    {
      id: 'evt-7',
      title: 'Video Call — Sarah Miller',
      start: dayInCurrentMonth(12, 9, 30),
      end: dayInCurrentMonth(12, 10, 0),
      color: getAppointmentTypeConfig(5).color,
      type: 'appointment',
      status: 'Confirmed',
      typeId: 5,
      location: 'Zoom',
    },
    {
      id: 'evt-8',
      title: 'On-Site Visit — Riverside Bakery',
      start: dayInCurrentMonth(15, 13, 0),
      end: dayInCurrentMonth(15, 14, 0),
      color: getAppointmentTypeConfig(6).color,
      type: 'appointment',
      status: 'Scheduled',
      typeId: 6,
      location: '482 Riverside Ave',
    },
    {
      id: 'evt-9',
      title: 'File Extension Request',
      start: dayInCurrentMonth(20, 12, 0),
      end: dayInCurrentMonth(20, 12, 0),
      color: getTaskPriorityConfig(2).color,
      type: 'task',
      status: 'NotStarted',
      priorityId: 2,
      description: 'Draft and file a filing extension for a small-business client.',
    },
    {
      id: 'evt-10',
      title: 'Follow-up — Estate Planning Docs',
      start: dayInCurrentMonth(25, 15, 0),
      end: dayInCurrentMonth(25, 15, 30),
      color: getAppointmentTypeConfig(1).color,
      type: 'appointment',
      status: 'Scheduled',
      typeId: 1,
    },
  ];
}

@Component({
  selector: 'app-dashboard-mini-calendar',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-mini-calendar.component.html',
  styleUrl: './dashboard-mini-calendar.component.scss',
})
export class DashboardMiniCalendarComponent {
  readonly weekDaysShort = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  private readonly allEvents = signal<CalendarEventData[]>(buildMockEvents());

  readonly currentDate = signal(new Date());
  readonly showModal = signal(false);
  readonly selectedDay = signal<CalendarDay | null>(null);

  readonly currentMonthYear = computed(() =>
    this.currentDate().toLocaleString('default', { month: 'short', year: 'numeric' })
  );

  readonly calendarDays = computed<CalendarDay[]>(() => this.generateCalendar(this.currentDate(), this.allEvents()));

  readonly todayEventsCount = computed(() => {
    const today = new Date();
    return this.allEvents().filter(event => this.isSameDay(event.start, today)).length;
  });

  readonly upcomingEventsCount = computed(() => {
    const today = new Date();
    return this.allEvents().filter(event => event.start > today).length;
  });

  private generateCalendar(currentDate: Date, events: CalendarEventData[]): CalendarDay[] {
    const days: CalendarDay[] = [];

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const firstDayOfWeek = firstDay.getDay();

    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const date = new Date(year, month - 1, prevMonthLastDay - i);
      days.push(this.createCalendarDay(date, false, events));
    }

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(year, month, day);
      days.push(this.createCalendarDay(date, true, events));
    }

    const remainingDays = 42 - days.length;
    for (let day = 1; day <= remainingDays; day++) {
      const date = new Date(year, month + 1, day);
      days.push(this.createCalendarDay(date, false, events));
    }

    return days;
  }

  private createCalendarDay(date: Date, isCurrentMonth: boolean, events: CalendarEventData[]): CalendarDay {
    const today = new Date();
    const dayEvents = events.filter(event => this.isSameDay(event.start, date));

    return {
      date,
      day: date.getDate(),
      isCurrentMonth,
      isToday: this.isSameDay(date, today),
      hasEvents: dayEvents.length > 0,
      eventsCount: dayEvents.length,
      events: dayEvents,
    };
  }

  private isSameDay(date1: Date, date2: Date): boolean {
    return (
      date1.getDate() === date2.getDate() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getFullYear() === date2.getFullYear()
    );
  }

  prevMonth(): void {
    const current = this.currentDate();
    this.currentDate.set(new Date(current.getFullYear(), current.getMonth() - 1, 1));
  }

  nextMonth(): void {
    const current = this.currentDate();
    this.currentDate.set(new Date(current.getFullYear(), current.getMonth() + 1, 1));
  }

  goToToday(): void {
    this.currentDate.set(new Date());
  }

  onDayClick(day: CalendarDay): void {
    if (!day.hasEvents || !day.isCurrentMonth) {
      return;
    }

    this.selectedDay.set(day);
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
    this.selectedDay.set(null);
  }

  getEventIcon(event: CalendarEventData): string {
    if (event.type === 'appointment') {
      return getAppointmentTypeConfig(event.typeId ?? 3).icon;
    }
    return getTaskPriorityConfig(event.priorityId ?? 2).icon;
  }

  getEventColor(event: CalendarEventData): string {
    return event.color;
  }

  formatEventTime(event: CalendarEventData): string {
    return event.start.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  formatModalDate(date: Date): string {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (this.isSameDay(date, today)) {
      return 'Today';
    } else if (this.isSameDay(date, tomorrow)) {
      return 'Tomorrow';
    }

    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }

  getDayClass(day: CalendarDay): string {
    const classes = ['calendar-day'];

    if (day.isToday) classes.push('today');
    if (!day.isCurrentMonth) classes.push('other-month');
    if (day.hasEvents) classes.push('has-events');

    return classes.join(' ');
  }

  getDayDotColor(day: CalendarDay): string {
    if (!day.hasEvents) return '';

    if (day.events.some(e => e.type === 'appointment')) {
      return '#3B82F6';
    }
    return '#EF4444';
  }

  getEventTypeLabel(event: CalendarEventData): string {
    return event.type === 'appointment' ? 'Appointment' : 'Task';
  }
}
