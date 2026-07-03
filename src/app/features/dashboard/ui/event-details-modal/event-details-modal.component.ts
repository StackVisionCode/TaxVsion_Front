import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Full detail view for a single appointment or task. No CalendarApiService /
 * TeamMembersService calls — creator info is baked directly into the mock
 * event objects. If no @Input() event is provided, ngOnInit falls back to a
 * fully populated static appointment so the modal never renders empty.
 * Action buttons (cancel/delete/mark complete/edit) are visual only: they
 * emit their @Output() after a short local spinner and then close.
 */
export type EventDetailsType = 'appointment' | 'task';

interface EventAttendeeInfo {
  id: string;
  name?: string;
  email?: string;
  customerId?: string | null;
  statusId: number;
  isOrganizer: boolean;
}

interface EventReminderInfo {
  id: string;
  minutesBefore: number;
  methodId: number;
  isSent: boolean;
}

interface EventDetailsSubTask {
  id: string;
  title: string;
  statusId: number;
}

export interface EventDetailsAppointment {
  id: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  typeId: number;
  statusId: number;
  isRecurring: boolean;
  recurrencePatternId?: number | null;
  customerName?: string | null;
  location?: string | null;
  meetingUrl?: string | null;
  notes?: string | null;
  attendees: EventAttendeeInfo[];
  reminders: EventReminderInfo[];
  creatorName?: string;
  creatorEmail?: string;
  createdAt: Date;
  updatedAt?: Date | null;
}

export interface EventDetailsTask {
  id: string;
  title: string;
  description?: string;
  dueDate?: Date | null;
  priorityId: number;
  statusId: number;
  completionPercentage: number;
  tags: string[];
  assignedToUserName?: string | null;
  assignedToUserEmail?: string | null;
  customerName?: string | null;
  reminders?: EventReminderInfo[];
  subTasks?: EventDetailsSubTask[];
  creatorName?: string;
  creatorEmail?: string;
  createdAt: Date;
  completedAt?: Date | null;
}

interface AppointmentTypeOption {
  id: number;
  label: string;
  icon: string;
  color: string;
}

interface AppointmentStatusOption {
  id: number;
  label: string;
  color: string;
}

interface TaskPriorityOption {
  id: number;
  label: string;
  icon: string;
  color: string;
}

interface TaskStatusOption {
  id: number;
  label: string;
  color: string;
}

interface RecurrencePatternOption {
  id: number;
  label: string;
}

interface ReminderMethodOption {
  id: number;
  label: string;
  icon: string;
}

interface AttendeeStatusOption {
  id: number;
  label: string;
  color: string;
}

const APPOINTMENT_TYPE_OPTIONS: AppointmentTypeOption[] = [
  { id: 1, label: 'Consultation', icon: 'people-outline', color: '#3B82F6' },
  { id: 2, label: 'Tax Review', icon: 'document-text-outline', color: '#8B5CF6' },
  { id: 3, label: 'Meeting', icon: 'calendar-outline', color: '#10B981' },
  { id: 4, label: 'Phone Call', icon: 'call-outline', color: '#F59E0B' },
  { id: 5, label: 'Video Call', icon: 'videocam-outline', color: '#EF4444' },
  { id: 6, label: 'On-Site', icon: 'location-outline', color: '#06B6D4' },
  { id: 7, label: 'Other', icon: 'ellipsis-horizontal-outline', color: '#6B7280' },
];

const APPOINTMENT_STATUS_OPTIONS: AppointmentStatusOption[] = [
  { id: 1, label: 'Scheduled', color: '#3B82F6' },
  { id: 2, label: 'Confirmed', color: '#10B981' },
  { id: 3, label: 'In Progress', color: '#F59E0B' },
  { id: 4, label: 'Completed', color: '#6B7280' },
  { id: 5, label: 'Cancelled', color: '#EF4444' },
  { id: 6, label: 'No Show', color: '#DC2626' },
];

const TASK_PRIORITY_OPTIONS: TaskPriorityOption[] = [
  { id: 1, label: 'Low', icon: 'arrow-down-outline', color: '#10B981' },
  { id: 2, label: 'Medium', icon: 'remove-outline', color: '#F59E0B' },
  { id: 3, label: 'High', icon: 'arrow-up-outline', color: '#EF4444' },
  { id: 4, label: 'Urgent', icon: 'warning-outline', color: '#DC2626' },
];

const TASK_STATUS_OPTIONS: TaskStatusOption[] = [
  { id: 1, label: 'Not Started', color: '#6B7280' },
  { id: 2, label: 'In Progress', color: '#3B82F6' },
  { id: 3, label: 'Blocked', color: '#EF4444' },
  { id: 4, label: 'Completed', color: '#10B981' },
  { id: 5, label: 'Cancelled', color: '#DC2626' },
];

const RECURRENCE_PATTERN_OPTIONS: RecurrencePatternOption[] = [
  { id: 1, label: 'None' },
  { id: 2, label: 'Daily' },
  { id: 3, label: 'Weekly' },
  { id: 4, label: 'Monthly' },
  { id: 5, label: 'Yearly' },
];

const REMINDER_METHOD_OPTIONS: ReminderMethodOption[] = [
  { id: 1, label: 'Email', icon: 'mail-outline' },
  { id: 2, label: 'Push Notification', icon: 'notifications-outline' },
  { id: 3, label: 'SMS', icon: 'chatbubble-outline' },
  { id: 4, label: 'In-App', icon: 'phone-portrait-outline' },
];

const ATTENDEE_STATUS_OPTIONS: AttendeeStatusOption[] = [
  { id: 1, label: 'Pending', color: '#F59E0B' },
  { id: 2, label: 'Accepted', color: '#10B981' },
  { id: 3, label: 'Declined', color: '#EF4444' },
  { id: 4, label: 'Tentative', color: '#6B7280' },
];

const DEFAULT_APPOINTMENT: EventDetailsAppointment = {
  id: 'apt-default-1',
  title: 'Tax Consultation - Sarah Johnson',
  description:
    'Annual tax planning session to review deduction opportunities, review estimated payments, and confirm documents needed before the filing deadline.',
  startTime: new Date('2026-07-06T14:00:00'),
  endTime: new Date('2026-07-06T15:00:00'),
  typeId: 1,
  statusId: 2,
  isRecurring: true,
  recurrencePatternId: 4,
  customerName: 'Sarah Johnson',
  location: 'Office - Room 2',
  meetingUrl: 'https://meet.taxvision.com/sarah-johnson-review',
  notes: 'Client requested extra time to discuss home office deduction eligibility.',
  attendees: [
    { id: 'att-1', name: 'Sarah Johnson', email: 'sarah.johnson@example.com', customerId: 'cust-1', statusId: 2, isOrganizer: false },
    { id: 'att-2', name: 'Emily Carter', email: 'emily.carter@taxvision.com', customerId: null, statusId: 2, isOrganizer: true },
  ],
  reminders: [
    { id: 'rem-1', minutesBefore: 60, methodId: 1, isSent: true },
    { id: 'rem-2', minutesBefore: 15, methodId: 2, isSent: false },
  ],
  creatorName: 'Emily Carter',
  creatorEmail: 'emily.carter@taxvision.com',
  createdAt: new Date('2026-06-20T09:15:00'),
  updatedAt: new Date('2026-06-28T11:40:00'),
};

@Component({
  selector: 'app-event-details-modal',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './event-details-modal.component.html',
  styleUrl: './event-details-modal.component.scss',
})
export class EventDetailsModalComponent implements OnInit {
  @Input() appointment: EventDetailsAppointment | null = null;
  @Input() task: EventDetailsTask | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() editRequested = new EventEmitter<{ type: EventDetailsType; data: EventDetailsAppointment | EventDetailsTask }>();
  @Output() deleteRequested = new EventEmitter<{ type: EventDetailsType; id: string }>();
  @Output() cancelRequested = new EventEmitter<{ type: EventDetailsType; id: string }>();
  @Output() completeRequested = new EventEmitter<string>();

  readonly deleting = signal(false);
  readonly cancelling = signal(false);
  readonly completing = signal(false);

  ngOnInit(): void {
    // No real event wired in yet — fall back to a fully populated mock appointment.
    if (!this.appointment && !this.task) {
      this.appointment = DEFAULT_APPOINTMENT;
    }
  }

  get eventType(): EventDetailsType {
    return this.appointment ? 'appointment' : 'task';
  }

  get isAppointment(): boolean {
    return !!this.appointment;
  }

  get isTask(): boolean {
    return !!this.task;
  }

  get appointmentTypeConfig(): AppointmentTypeOption | null {
    if (!this.appointment) return null;
    return APPOINTMENT_TYPE_OPTIONS.find(t => t.id === this.appointment!.typeId) ?? null;
  }

  get appointmentStatusConfig(): AppointmentStatusOption | null {
    if (!this.appointment) return null;
    return APPOINTMENT_STATUS_OPTIONS.find(s => s.id === this.appointment!.statusId) ?? null;
  }

  get recurrencePatternConfig(): RecurrencePatternOption | null {
    if (!this.appointment || !this.appointment.recurrencePatternId) return null;
    return RECURRENCE_PATTERN_OPTIONS.find(r => r.id === this.appointment!.recurrencePatternId) ?? null;
  }

  get taskPriorityConfig(): TaskPriorityOption | null {
    if (!this.task) return null;
    return TASK_PRIORITY_OPTIONS.find(p => p.id === this.task!.priorityId) ?? null;
  }

  get taskStatusConfig(): TaskStatusOption | null {
    if (!this.task) return null;
    return TASK_STATUS_OPTIONS.find(s => s.id === this.task!.statusId) ?? null;
  }

  getReminderMethod(methodId: number): ReminderMethodOption {
    return REMINDER_METHOD_OPTIONS.find(r => r.id === methodId) ?? REMINDER_METHOD_OPTIONS[0];
  }

  getAttendeeStatus(statusId: number): AttendeeStatusOption {
    return ATTENDEE_STATUS_OPTIONS.find(a => a.id === statusId) ?? ATTENDEE_STATUS_OPTIONS[0];
  }

  get canCancelAppointment(): boolean {
    if (!this.appointment) return false;
    return this.appointment.statusId !== 5 && this.appointment.statusId !== 4;
  }

  get canCompleteTask(): boolean {
    if (!this.task) return false;
    return this.task.statusId !== 4 && this.task.statusId !== 5;
  }

  formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  formatDateTime(date: Date): string {
    return date.toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays > 0 && diffDays <= 7) return `${diffDays} days from now`;
    if (diffDays < 0 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`;

    return this.formatDate(date);
  }

  isTaskOverdue(task: EventDetailsTask): boolean {
    if (!task.dueDate || task.statusId === 4) return false;
    return task.dueDate < new Date();
  }

  onEdit(): void {
    if (this.appointment) {
      this.editRequested.emit({ type: 'appointment', data: this.appointment });
    } else if (this.task) {
      this.editRequested.emit({ type: 'task', data: this.task });
    }
    this.close();
  }

  onDelete(): void {
    if (this.deleting()) return;
    this.deleting.set(true);

    setTimeout(() => {
      if (this.appointment) {
        this.deleteRequested.emit({ type: 'appointment', id: this.appointment.id });
      } else if (this.task) {
        this.deleteRequested.emit({ type: 'task', id: this.task.id });
      }
      this.deleting.set(false);
      this.close();
    }, 500);
  }

  onCancel(): void {
    if (!this.appointment || this.cancelling()) return;
    this.cancelling.set(true);

    setTimeout(() => {
      this.cancelRequested.emit({ type: 'appointment', id: this.appointment!.id });
      this.cancelling.set(false);
      this.close();
    }, 500);
  }

  onCompleteTask(): void {
    if (!this.task || this.completing()) return;
    this.completing.set(true);

    setTimeout(() => {
      this.completeRequested.emit(this.task!.id);
      this.completing.set(false);
      this.close();
    }, 500);
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }
}
