import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

/**
 * Visual-only create/edit task modal. There is no CalendarApiService, no
 * CustomerService and no TeamMembersService here - the assignee/client/
 * priority/status dropdowns are small static arrays baked into this file,
 * and "saving" just emits the form value back to the parent (see
 * `dashboard-tasks.component.ts`) which updates its own local signal array.
 * The Reactive Form is kept only for its visual validation states
 * (required title/priority, disabled submit button while invalid).
 */
export type TaskAssignmentType = 'none' | 'team_member' | 'customer';

export interface TaskReminder {
  minutesBefore: number;
  methodId: number;
}

export interface TaskModalData {
  id?: string;
  title: string;
  description: string;
  dueDate: string;
  priorityId: number;
  statusId: number;
  completionPercentage: number;
  assignmentType: TaskAssignmentType;
  customerId: string | null;
  assignedToUserId: string | null;
  tags: string[];
  reminders: TaskReminder[];
}

interface PriorityOption {
  id: number;
  label: string;
  color: string;
  icon: string;
}

interface StatusOption {
  id: number;
  label: string;
  color: string;
}

interface ReminderMethodOption {
  id: number;
  label: string;
  icon: string;
}

interface TeamMemberOption {
  id: string;
  name: string;
  isOwner?: boolean;
}

interface ClientOption {
  id: string;
  name: string;
}

const PRIORITY_OPTIONS: PriorityOption[] = [
  { id: 1, label: 'Low', color: '#10B981', icon: 'arrow-down-outline' },
  { id: 2, label: 'Medium', color: '#F59E0B', icon: 'remove-outline' },
  { id: 3, label: 'High', color: '#EF4444', icon: 'arrow-up-outline' },
  { id: 4, label: 'Urgent', color: '#DC2626', icon: 'warning-outline' },
];

const STATUS_OPTIONS: StatusOption[] = [
  { id: 1, label: 'Not Started', color: '#6B7280' },
  { id: 2, label: 'In Progress', color: '#3B82F6' },
  { id: 3, label: 'Blocked', color: '#EF4444' },
  { id: 4, label: 'Completed', color: '#10B981' },
  { id: 5, label: 'Cancelled', color: '#DC2626' },
];

const REMINDER_METHOD_OPTIONS: ReminderMethodOption[] = [
  { id: 1, label: 'Email', icon: 'mail-outline' },
  { id: 2, label: 'Push Notification', icon: 'notifications-outline' },
  { id: 3, label: 'SMS', icon: 'chatbubble-outline' },
  { id: 4, label: 'In-App', icon: 'phone-portrait-outline' },
];

const TEAM_MEMBERS: TeamMemberOption[] = [
  { id: 'tm-1', name: 'Sarah Mitchell', isOwner: true },
  { id: 'tm-2', name: 'James Cooper' },
  { id: 'tm-3', name: 'Elena Vargas' },
  { id: 'tm-4', name: 'Marcus Chen' },
];

const CLIENTS: ClientOption[] = [
  { id: 'cl-1', name: 'Johnson & Co LLC' },
  { id: 'cl-2', name: 'Maria Alvarez' },
  { id: 'cl-3', name: 'Sunrise Bakery Inc.' },
  { id: 'cl-4', name: 'Robert Kim' },
  { id: 'cl-5', name: 'Delgado Family Trust' },
  { id: 'cl-6', name: 'Nguyen Enterprises' },
  { id: 'cl-7', name: 'Patel Consulting' },
];

@Component({
  selector: 'app-task-modal',
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './task-modal.component.html',
  styleUrl: './task-modal.component.scss',
})
export class TaskModalComponent implements OnInit {
  private readonly fb = inject(FormBuilder);

  /** Pass a task to edit it; leave null/undefined to create a new one. */
  @Input() task: TaskModalData | null = null;
  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<TaskModalData>();

  readonly priorityOptions = PRIORITY_OPTIONS;
  readonly statusOptions = STATUS_OPTIONS;
  readonly reminderMethods = REMINDER_METHOD_OPTIONS;
  readonly teamMembers = TEAM_MEMBERS;
  readonly clients = CLIENTS;

  readonly isEditMode = signal(false);
  readonly saving = signal(false);
  readonly tags = signal<string[]>([]);
  readonly reminders = signal<TaskReminder[]>([]);

  newTag = '';

  form: FormGroup = this.fb.group({
    assignmentType: ['none' as TaskAssignmentType],
    customerId: [''],
    assignedToUserId: [''],
    title: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    dueDate: [''],
    priorityId: [2, Validators.required],
    statusId: [1],
    completionPercentage: [0],
  });

  ngOnInit(): void {
    if (this.task) {
      this.isEditMode.set(true);
      this.form.patchValue({
        assignmentType: this.task.assignmentType,
        customerId: this.task.customerId ?? '',
        assignedToUserId: this.task.assignedToUserId ?? '',
        title: this.task.title,
        description: this.task.description,
        dueDate: this.task.dueDate,
        priorityId: this.task.priorityId,
        statusId: this.task.statusId,
        completionPercentage: this.task.completionPercentage,
      });
      this.tags.set([...this.task.tags]);
      this.reminders.set(this.task.reminders.map(reminder => ({ ...reminder })));
    } else {
      this.isEditMode.set(false);
      this.form.patchValue({ dueDate: this.defaultDueDate() });
    }
  }

  setAssignmentType(type: TaskAssignmentType): void {
    this.form.patchValue({ assignmentType: type });
    if (type === 'none') {
      this.form.patchValue({ customerId: '', assignedToUserId: '' });
    } else if (type === 'team_member') {
      this.form.patchValue({ customerId: '' });
    } else if (type === 'customer') {
      this.form.patchValue({ assignedToUserId: '' });
    }
  }

  getPriorityColor(priorityId: number): string {
    return this.priorityOptions.find(priority => priority.id === priorityId)?.color ?? '#6B7280';
  }

  addTag(): void {
    const value = this.newTag.trim();
    if (value && !this.tags().includes(value)) {
      this.tags.update(list => [...list, value]);
      this.newTag = '';
    }
  }

  removeTag(index: number): void {
    this.tags.update(list => list.filter((_, i) => i !== index));
  }

  addReminder(): void {
    this.reminders.update(list => [...list, { minutesBefore: 60, methodId: 1 }]);
  }

  removeReminder(index: number): void {
    this.reminders.update(list => list.filter((_, i) => i !== index));
  }

  updateReminderMinutes(index: number, value: string): void {
    const minutesBefore = Number(value) || 0;
    this.reminders.update(list => list.map((reminder, i) => (i === index ? { ...reminder, minutesBefore } : reminder)));
  }

  updateReminderMethod(index: number, value: string): void {
    const methodId = Number(value);
    this.reminders.update(list => list.map((reminder, i) => (i === index ? { ...reminder, methodId } : reminder)));
  }

  isFormValid(): boolean {
    return this.form.valid;
  }

  onSave(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);

    const value = this.form.getRawValue();
    const result: TaskModalData = {
      id: this.task?.id,
      title: (value.title as string).trim(),
      description: value.description ?? '',
      dueDate: value.dueDate ?? '',
      priorityId: value.priorityId,
      statusId: value.statusId,
      completionPercentage: value.completionPercentage,
      assignmentType: value.assignmentType,
      customerId: value.customerId || null,
      assignedToUserId: value.assignedToUserId || null,
      tags: this.tags(),
      reminders: this.reminders(),
    };

    // No backend wired up yet: simulate a brief save delay so the spinner
    // reads as real feedback, then hand the value back to the parent.
    setTimeout(() => {
      this.saving.set(false);
      this.save.emit(result);
    }, 300);
  }

  onClose(): void {
    this.close.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }

  private defaultDueDate(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(17, 0, 0, 0);
    return this.toDateTimeLocal(tomorrow);
  }

  private toDateTimeLocal(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }
}
