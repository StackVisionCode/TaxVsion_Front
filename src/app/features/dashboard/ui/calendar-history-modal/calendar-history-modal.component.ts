import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/**
 * Log of past calendar appointments and tasks. No CalendarApiService call —
 * the two lists are static realistic mock data baked into the component.
 * Tab switching, search, date-range/type/status filtering, "clear filters"
 * and pagination are all kept fully working locally against the mock arrays.
 */
type CalendarHistoryTab = 'appointments' | 'tasks';

interface CalendarHistoryAppointment {
  id: string;
  title: string;
  description?: string;
  customerName?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  typeId: number;
  statusId: number;
}

interface CalendarHistoryTask {
  id: string;
  title: string;
  description?: string;
  customerName?: string;
  dueDate?: Date;
  priorityId: number;
  statusId: number;
  completionPercentage: number;
  tags: string[];
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

interface HistoryFilterState {
  search: string;
  startDate: string;
  endDate: string;
  typeId: number | null;
  statusId: number | null;
  priorityId: number | null;
}

interface HistoryPaginationState {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
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

const MOCK_APPOINTMENTS: CalendarHistoryAppointment[] = [
  {
    id: 'apt-1',
    title: 'Tax Consultation - Sarah Johnson',
    description: 'Reviewed 2025 filing status and deduction options.',
    customerName: 'Sarah Johnson',
    location: 'Office - Room 2',
    startTime: new Date('2026-06-24T14:00:00'),
    endTime: new Date('2026-06-24T15:00:00'),
    typeId: 1,
    statusId: 4,
  },
  {
    id: 'apt-2',
    title: 'Quarterly Review - Acme Corp',
    description: 'Q2 financial review and upcoming filing deadlines.',
    customerName: 'Acme Corp',
    location: 'Video Call',
    startTime: new Date('2026-06-22T10:30:00'),
    endTime: new Date('2026-06-22T11:30:00'),
    typeId: 2,
    statusId: 4,
  },
  {
    id: 'apt-3',
    title: 'Document Signing - Robert Chen',
    description: 'Final signature on amended return.',
    customerName: 'Robert Chen',
    location: 'Office - Room 1',
    startTime: new Date('2026-06-19T09:00:00'),
    endTime: new Date('2026-06-19T09:30:00'),
    typeId: 6,
    statusId: 4,
  },
  {
    id: 'apt-4',
    title: 'Follow-up Call - Linda Martinez',
    description: 'Clarified questions about estimated payments.',
    customerName: 'Linda Martinez',
    startTime: new Date('2026-06-17T16:00:00'),
    endTime: new Date('2026-06-17T16:20:00'),
    typeId: 4,
    statusId: 6,
  },
  {
    id: 'apt-5',
    title: 'Onboarding Meeting - Bright Future LLC',
    description: 'Kickoff meeting for new bookkeeping engagement.',
    customerName: 'Bright Future LLC',
    location: 'Video Call',
    startTime: new Date('2026-06-15T13:00:00'),
    endTime: new Date('2026-06-15T14:00:00'),
    typeId: 5,
    statusId: 4,
  },
  {
    id: 'apt-6',
    title: 'Tax Review - David Kim',
    description: 'Reviewed prior-year carryover losses.',
    customerName: 'David Kim',
    location: 'Office - Room 2',
    startTime: new Date('2026-06-11T11:00:00'),
    endTime: new Date('2026-06-11T12:00:00'),
    typeId: 2,
    statusId: 5,
  },
  {
    id: 'apt-7',
    title: 'On-Site Audit Support - Meridian Retail',
    description: 'Assisted with state audit documentation on location.',
    customerName: 'Meridian Retail',
    location: '482 Harbor Ave, Suite 300',
    startTime: new Date('2026-06-08T09:00:00'),
    endTime: new Date('2026-06-08T12:00:00'),
    typeId: 6,
    statusId: 4,
  },
  {
    id: 'apt-8',
    title: 'Consultation - Priya Patel',
    description: 'Discussed retirement account contribution strategy.',
    customerName: 'Priya Patel',
    location: 'Office - Room 1',
    startTime: new Date('2026-06-03T15:30:00'),
    endTime: new Date('2026-06-03T16:15:00'),
    typeId: 1,
    statusId: 4,
  },
];

const MOCK_TASKS: CalendarHistoryTask[] = [
  {
    id: 'task-1',
    title: 'File extension for Acme Corp',
    description: 'Submit Form 7004 before the deadline.',
    customerName: 'Acme Corp',
    dueDate: new Date('2026-06-25T17:00:00'),
    priorityId: 4,
    statusId: 4,
    completionPercentage: 100,
    tags: ['extension', 'corporate'],
  },
  {
    id: 'task-2',
    title: 'Reconcile Q2 bank statements',
    description: 'Match transactions for Bright Future LLC.',
    customerName: 'Bright Future LLC',
    dueDate: new Date('2026-06-20T17:00:00'),
    priorityId: 2,
    statusId: 4,
    completionPercentage: 100,
    tags: ['bookkeeping'],
  },
  {
    id: 'task-3',
    title: 'Prepare amended return - Robert Chen',
    description: 'Draft Form 1040-X for review.',
    customerName: 'Robert Chen',
    dueDate: new Date('2026-06-18T17:00:00'),
    priorityId: 3,
    statusId: 4,
    completionPercentage: 100,
    tags: ['amendment', 'individual'],
  },
  {
    id: 'task-4',
    title: 'Send engagement letter - Meridian Retail',
    description: 'Draft and send updated engagement letter.',
    customerName: 'Meridian Retail',
    dueDate: new Date('2026-06-14T17:00:00'),
    priorityId: 2,
    statusId: 5,
    completionPercentage: 0,
    tags: ['admin'],
  },
  {
    id: 'task-5',
    title: 'Collect W-9 forms',
    description: 'Follow up with vendors missing W-9 forms.',
    customerName: 'Acme Corp',
    dueDate: new Date('2026-06-12T17:00:00'),
    priorityId: 1,
    statusId: 4,
    completionPercentage: 100,
    tags: ['compliance'],
  },
  {
    id: 'task-6',
    title: 'Review payroll tax filings',
    description: 'Confirm Q2 941 filings were accepted.',
    customerName: 'Meridian Retail',
    dueDate: new Date('2026-06-09T17:00:00'),
    priorityId: 3,
    statusId: 4,
    completionPercentage: 100,
    tags: ['payroll', 'compliance'],
  },
  {
    id: 'task-7',
    title: 'Update client contact info',
    description: 'Sync new address for Linda Martinez.',
    customerName: 'Linda Martinez',
    dueDate: new Date('2026-06-05T17:00:00'),
    priorityId: 1,
    statusId: 4,
    completionPercentage: 100,
    tags: ['admin'],
  },
];

function emptyFilters(): HistoryFilterState {
  return { search: '', startDate: '', endDate: '', typeId: null, statusId: null, priorityId: null };
}

@Component({
  selector: 'app-calendar-history-modal',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './calendar-history-modal.component.html',
  styleUrl: './calendar-history-modal.component.scss',
})
export class CalendarHistoryModalComponent {
  @Output() closed = new EventEmitter<void>();
  @Output() appointmentSelected = new EventEmitter<CalendarHistoryAppointment>();
  @Output() taskSelected = new EventEmitter<CalendarHistoryTask>();

  readonly appointmentTypeOptions = APPOINTMENT_TYPE_OPTIONS;
  readonly appointmentStatusOptions = APPOINTMENT_STATUS_OPTIONS;
  readonly taskPriorityOptions = TASK_PRIORITY_OPTIONS;
  readonly taskStatusOptions = TASK_STATUS_OPTIONS;

  readonly Math = Math;
  private readonly pageSize = 5;

  readonly activeTab = signal<CalendarHistoryTab>('appointments');

  readonly appointments = signal<CalendarHistoryAppointment[]>(MOCK_APPOINTMENTS);
  readonly tasks = signal<CalendarHistoryTask[]>(MOCK_TASKS);

  readonly appointmentFilters = signal<HistoryFilterState>(emptyFilters());
  readonly taskFilters = signal<HistoryFilterState>(emptyFilters());

  readonly appointmentPage = signal(1);
  readonly taskPage = signal(1);

  readonly currentFilters = computed<HistoryFilterState>(() =>
    this.activeTab() === 'appointments' ? this.appointmentFilters() : this.taskFilters()
  );

  private readonly filteredAppointmentsAll = computed(() => {
    let list = [...this.appointments()];
    const f = this.appointmentFilters();

    if (f.search) {
      const search = f.search.toLowerCase();
      list = list.filter(
        a =>
          a.title.toLowerCase().includes(search) ||
          a.description?.toLowerCase().includes(search) ||
          a.customerName?.toLowerCase().includes(search) ||
          a.location?.toLowerCase().includes(search)
      );
    }

    if (f.startDate) {
      const start = new Date(f.startDate);
      list = list.filter(a => a.startTime >= start);
    }

    if (f.endDate) {
      const end = new Date(f.endDate);
      end.setHours(23, 59, 59, 999);
      list = list.filter(a => a.startTime <= end);
    }

    if (f.typeId) list = list.filter(a => a.typeId === f.typeId);
    if (f.statusId) list = list.filter(a => a.statusId === f.statusId);

    return list.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  });

  private readonly filteredTasksAll = computed(() => {
    let list = [...this.tasks()];
    const f = this.taskFilters();

    if (f.search) {
      const search = f.search.toLowerCase();
      list = list.filter(
        t =>
          t.title.toLowerCase().includes(search) ||
          t.description?.toLowerCase().includes(search) ||
          t.customerName?.toLowerCase().includes(search) ||
          t.tags.some(tag => tag.toLowerCase().includes(search))
      );
    }

    if (f.startDate) {
      const start = new Date(f.startDate);
      list = list.filter(t => t.dueDate && t.dueDate >= start);
    }

    if (f.endDate) {
      const end = new Date(f.endDate);
      end.setHours(23, 59, 59, 999);
      list = list.filter(t => t.dueDate && t.dueDate <= end);
    }

    if (f.priorityId) list = list.filter(t => t.priorityId === f.priorityId);
    if (f.statusId) list = list.filter(t => t.statusId === f.statusId);

    return list.sort((a, b) => (b.dueDate?.getTime() ?? 0) - (a.dueDate?.getTime() ?? 0));
  });

  readonly appointmentPagination = computed<HistoryPaginationState>(() => {
    const totalItems = this.filteredAppointmentsAll().length;
    const totalPages = Math.max(1, Math.ceil(totalItems / this.pageSize));
    const page = Math.min(Math.max(1, this.appointmentPage()), totalPages);
    return { page, pageSize: this.pageSize, totalItems, totalPages };
  });

  readonly taskPagination = computed<HistoryPaginationState>(() => {
    const totalItems = this.filteredTasksAll().length;
    const totalPages = Math.max(1, Math.ceil(totalItems / this.pageSize));
    const page = Math.min(Math.max(1, this.taskPage()), totalPages);
    return { page, pageSize: this.pageSize, totalItems, totalPages };
  });

  readonly currentPagination = computed<HistoryPaginationState>(() =>
    this.activeTab() === 'appointments' ? this.appointmentPagination() : this.taskPagination()
  );

  readonly filteredAppointments = computed(() => {
    const { page } = this.appointmentPagination();
    const start = (page - 1) * this.pageSize;
    return this.filteredAppointmentsAll().slice(start, start + this.pageSize);
  });

  readonly filteredTasks = computed(() => {
    const { page } = this.taskPagination();
    const start = (page - 1) * this.pageSize;
    return this.filteredTasksAll().slice(start, start + this.pageSize);
  });

  readonly paginationPages = computed<number[]>(() => {
    const pagination = this.currentPagination();
    const pages: number[] = [];
    const maxVisible = 5;

    let start = Math.max(1, pagination.page - Math.floor(maxVisible / 2));
    const end = Math.min(pagination.totalPages, start + maxVisible - 1);
    start = Math.max(1, Math.min(start, end - maxVisible + 1));

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    return pages;
  });

  readonly hasActiveFilters = computed(() => {
    const f = this.currentFilters();
    if (this.activeTab() === 'appointments') {
      return !!(f.search || f.startDate || f.endDate || f.typeId || f.statusId);
    }
    return !!(f.search || f.startDate || f.endDate || f.priorityId || f.statusId);
  });

  setActiveTab(tab: CalendarHistoryTab): void {
    this.activeTab.set(tab);
  }

  updateSearch(value: string): void {
    if (this.activeTab() === 'appointments') {
      this.appointmentFilters.update(f => ({ ...f, search: value }));
      this.appointmentPage.set(1);
    } else {
      this.taskFilters.update(f => ({ ...f, search: value }));
      this.taskPage.set(1);
    }
  }

  updateStartDate(value: string): void {
    if (this.activeTab() === 'appointments') {
      this.appointmentFilters.update(f => ({ ...f, startDate: value }));
      this.appointmentPage.set(1);
    } else {
      this.taskFilters.update(f => ({ ...f, startDate: value }));
      this.taskPage.set(1);
    }
  }

  updateEndDate(value: string): void {
    if (this.activeTab() === 'appointments') {
      this.appointmentFilters.update(f => ({ ...f, endDate: value }));
      this.appointmentPage.set(1);
    } else {
      this.taskFilters.update(f => ({ ...f, endDate: value }));
      this.taskPage.set(1);
    }
  }

  updateTypeId(value: number | null): void {
    this.appointmentFilters.update(f => ({ ...f, typeId: value ? Number(value) : null }));
    this.appointmentPage.set(1);
  }

  updateAppointmentStatusId(value: number | null): void {
    this.appointmentFilters.update(f => ({ ...f, statusId: value ? Number(value) : null }));
    this.appointmentPage.set(1);
  }

  updatePriorityId(value: number | null): void {
    this.taskFilters.update(f => ({ ...f, priorityId: value ? Number(value) : null }));
    this.taskPage.set(1);
  }

  updateTaskStatusId(value: number | null): void {
    this.taskFilters.update(f => ({ ...f, statusId: value ? Number(value) : null }));
    this.taskPage.set(1);
  }

  clearFilters(): void {
    if (this.activeTab() === 'appointments') {
      this.appointmentFilters.set(emptyFilters());
      this.appointmentPage.set(1);
    } else {
      this.taskFilters.set(emptyFilters());
      this.taskPage.set(1);
    }
  }

  goToPage(page: number): void {
    const pagination = this.currentPagination();
    if (page < 1 || page > pagination.totalPages) return;

    if (this.activeTab() === 'appointments') {
      this.appointmentPage.set(page);
    } else {
      this.taskPage.set(page);
    }
  }

  onAppointmentClick(appointment: CalendarHistoryAppointment): void {
    this.appointmentSelected.emit(appointment);
  }

  onTaskClick(task: CalendarHistoryTask): void {
    this.taskSelected.emit(task);
  }

  getAppointmentType(typeId: number): AppointmentTypeOption {
    return APPOINTMENT_TYPE_OPTIONS.find(t => t.id === typeId) ?? APPOINTMENT_TYPE_OPTIONS[APPOINTMENT_TYPE_OPTIONS.length - 1];
  }

  getAppointmentStatus(statusId: number): AppointmentStatusOption {
    return APPOINTMENT_STATUS_OPTIONS.find(s => s.id === statusId) ?? APPOINTMENT_STATUS_OPTIONS[0];
  }

  getTaskPriority(priorityId: number): TaskPriorityOption {
    return TASK_PRIORITY_OPTIONS.find(p => p.id === priorityId) ?? TASK_PRIORITY_OPTIONS[0];
  }

  getTaskStatus(statusId: number): TaskStatusOption {
    return TASK_STATUS_OPTIONS.find(s => s.id === statusId) ?? TASK_STATUS_OPTIONS[0];
  }

  formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  isOverdue(date: Date): boolean {
    return date < new Date();
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
