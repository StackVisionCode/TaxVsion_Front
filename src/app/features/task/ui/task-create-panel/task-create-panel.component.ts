import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskItem, TaskPriority, TaskStatus, TASK_COLUMNS } from '../task-board/task-board.component';

interface TeamMember {
  name: string;
  initials: string;
  color: string;
}

const TEAM_MEMBERS: TeamMember[] = [
  { name: 'You', initials: 'ME', color: 'bg-gray-900' },
  { name: 'James Cooper', initials: 'JC', color: 'bg-indigo-500' },
  { name: 'Elena Vargas', initials: 'EV', color: 'bg-orange-500' },
  { name: 'Sarah Mitchell', initials: 'SM', color: 'bg-[#7C6AE0]' },
  { name: 'Aisha Thompson', initials: 'AT', color: 'bg-emerald-500' },
];

const PRIORITIES: TaskPriority[] = ['Low', 'Medium', 'High', 'Urgent'];

/**
 * Overlay de creación/edición del módulo Task (mismo patrón que
 * mail-compose): tarjeta centrada `rounded-[28px]` sobre backdrop con
 * stopPropagation. Un único componente cubre ambos modos: si `task` llega
 * con datos precarga el formulario y actúa como edición ("Edit Task" /
 * "Save changes"); si es null arranca vacío ("New Task" / "Create task").
 * Los selectores de prioridad/estado/asignado son píldoras con dropdown
 * propio (patrón dashboard-filters) que se cierran al hacer click fuera.
 */
@Component({
  selector: 'app-task-create-panel',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './task-create-panel.component.html',
})
export class TaskCreatePanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() task: TaskItem | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<TaskItem>();

  readonly team = TEAM_MEMBERS;
  readonly priorities = PRIORITIES;
  readonly statuses = TASK_COLUMNS;

  readonly title = signal('');
  readonly description = signal('');
  readonly client = signal('');
  readonly dueDate = signal('');
  readonly priority = signal<TaskPriority>('Medium');
  readonly status = signal<TaskStatus>('not-started');
  readonly assignee = signal<TeamMember>(TEAM_MEMBERS[0]);

  readonly isPriorityOpen = signal(false);
  readonly isStatusOpen = signal(false);
  readonly isAssigneeOpen = signal(false);

  /** Signal propia porque `task` es un @Input plano: un computed() no reaccionaría a sus cambios. */
  readonly isEditMode = signal(false);
  readonly canSave = computed(() => this.title().trim().length > 0 && !!this.dueDate());

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['task'] || changes['isOpen']) {
      this.isEditMode.set(this.task !== null);
      this.resetForm();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="task-priority"]')) {
      this.isPriorityOpen.set(false);
    }
    if (!target.closest('[data-dropdown="task-status"]')) {
      this.isStatusOpen.set(false);
    }
    if (!target.closest('[data-dropdown="task-assignee"]')) {
      this.isAssigneeOpen.set(false);
    }
  }

  togglePriorityDropdown(): void {
    const next = !this.isPriorityOpen();
    this.closeAllDropdowns();
    this.isPriorityOpen.set(next);
  }

  toggleStatusDropdown(): void {
    const next = !this.isStatusOpen();
    this.closeAllDropdowns();
    this.isStatusOpen.set(next);
  }

  toggleAssigneeDropdown(): void {
    const next = !this.isAssigneeOpen();
    this.closeAllDropdowns();
    this.isAssigneeOpen.set(next);
  }

  selectPriority(priority: TaskPriority): void {
    this.priority.set(priority);
    this.isPriorityOpen.set(false);
  }

  selectStatus(status: TaskStatus): void {
    this.status.set(status);
    this.isStatusOpen.set(false);
  }

  selectAssignee(member: TeamMember): void {
    this.assignee.set(member);
    this.isAssigneeOpen.set(false);
  }

  statusLabel(status: TaskStatus): string {
    return this.statuses.find(column => column.id === status)?.label ?? status;
  }

  close(): void {
    this.closed.emit();
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }
    const member = this.assignee();
    const result: TaskItem = {
      id: this.task?.id ?? `task-${Date.now()}`,
      title: this.title().trim(),
      description: this.description().trim(),
      client: this.client().trim(),
      dueDate: this.dueDate(),
      priority: this.priority(),
      status: this.status(),
      assigneeName: member.name,
      assigneeInitials: member.initials,
      assigneeColor: member.color,
    };
    this.saved.emit(result);
  }

  private closeAllDropdowns(): void {
    this.isPriorityOpen.set(false);
    this.isStatusOpen.set(false);
    this.isAssigneeOpen.set(false);
  }

  private resetForm(): void {
    const task = this.task;
    if (task) {
      this.title.set(task.title);
      this.description.set(task.description);
      this.client.set(task.client);
      this.dueDate.set(task.dueDate.slice(0, 10));
      this.priority.set(task.priority);
      this.status.set(task.status);
      this.assignee.set(this.team.find(member => member.initials === task.assigneeInitials) ?? this.team[0]);
    } else {
      this.title.set('');
      this.description.set('');
      this.client.set('');
      this.dueDate.set('');
      this.priority.set('Medium');
      this.status.set('not-started');
      this.assignee.set(this.team[0]);
    }
    this.closeAllDropdowns();
  }
}
