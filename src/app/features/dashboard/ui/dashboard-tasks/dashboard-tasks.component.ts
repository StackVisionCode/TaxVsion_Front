import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TaskModalComponent, TaskModalData } from '../task-modal/task-modal.component';

/**
 * Static placeholder task widget for the dashboard. The original pulled
 * tasks from TaskService/CustomerService/TaxUserApiService and enriched
 * them with live customer/user names; here the "enriched" fields are just
 * baked straight into the mock data. Checking a task off and filtering the
 * list ("My Tasks" / "All Tasks" / "Overdue") are real local interactions
 * against the `tasks` signal. Adding/editing a task opens `app-task-modal`
 * purely through local signal state (`showTaskModal`) - there is no modal
 * service and nothing is persisted anywhere.
 */
type TaskFilter = 'all' | 'my' | 'overdue';

interface Task {
  id: string;
  title: string;
  description: string;
  dueDate: string; // ISO datetime string
  priorityId: number;
  priorityLabel: string;
  priorityColor: string;
  priorityIcon: string;
  statusId: number;
  statusLabel: string;
  statusColor: string;
  assigneeName: string;
  clientName: string | null;
  completed: boolean;
  tags: string[];
}

function isoInDays(days: number, hour = 17, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

const INITIAL_TASKS: Task[] = [
  {
    id: 'task-1',
    title: 'Prepare Q2 tax filing',
    description: 'Assemble supporting documents and finalize the quarterly filing package.',
    dueDate: isoInDays(2),
    priorityId: 3,
    priorityLabel: 'High',
    priorityColor: '#EF4444',
    priorityIcon: 'arrow-up-outline',
    statusId: 2,
    statusLabel: 'In Progress',
    statusColor: '#3B82F6',
    assigneeName: 'You',
    clientName: 'Johnson & Co LLC',
    completed: false,
    tags: ['Filing', 'Q2'],
  },
  {
    id: 'task-2',
    title: 'Follow up on missing W-2 documents',
    description: 'Client still needs to upload their W-2 forms before we can proceed.',
    dueDate: isoInDays(1),
    priorityId: 2,
    priorityLabel: 'Medium',
    priorityColor: '#F59E0B',
    priorityIcon: 'remove-outline',
    statusId: 1,
    statusLabel: 'Not Started',
    statusColor: '#6B7280',
    assigneeName: 'James Cooper',
    clientName: 'Maria Alvarez',
    completed: false,
    tags: ['Documents'],
  },
  {
    id: 'task-3',
    title: 'Review depreciation schedule',
    description: 'Double-check the asset depreciation schedule before it goes to the reviewer.',
    dueDate: isoInDays(-2),
    priorityId: 4,
    priorityLabel: 'Urgent',
    priorityColor: '#DC2626',
    priorityIcon: 'warning-outline',
    statusId: 3,
    statusLabel: 'Blocked',
    statusColor: '#EF4444',
    assigneeName: 'You',
    clientName: 'Sunrise Bakery Inc.',
    completed: false,
    tags: ['Review', 'Assets'],
  },
  {
    id: 'task-4',
    title: 'Send engagement letter',
    description: 'Draft and send the new engagement letter for the upcoming tax year.',
    dueDate: isoInDays(5),
    priorityId: 1,
    priorityLabel: 'Low',
    priorityColor: '#10B981',
    priorityIcon: 'arrow-down-outline',
    statusId: 1,
    statusLabel: 'Not Started',
    statusColor: '#6B7280',
    assigneeName: 'Elena Vargas',
    clientName: 'Robert Kim',
    completed: false,
    tags: ['Engagement'],
  },
  {
    id: 'task-5',
    title: 'Reconcile Q1 payroll reports',
    description: 'Match payroll totals against the general ledger for Q1.',
    dueDate: isoInDays(1),
    priorityId: 2,
    priorityLabel: 'Medium',
    priorityColor: '#F59E0B',
    priorityIcon: 'remove-outline',
    statusId: 2,
    statusLabel: 'In Progress',
    statusColor: '#3B82F6',
    assigneeName: 'Marcus Chen',
    clientName: null,
    completed: false,
    tags: ['Payroll', 'Internal'],
  },
  {
    id: 'task-6',
    title: 'Client onboarding call',
    description: 'Kickoff call to walk the new client through the document portal.',
    dueDate: isoInDays(0),
    priorityId: 3,
    priorityLabel: 'High',
    priorityColor: '#EF4444',
    priorityIcon: 'arrow-up-outline',
    statusId: 1,
    statusLabel: 'Not Started',
    statusColor: '#6B7280',
    assigneeName: 'Sarah Mitchell',
    clientName: 'Delgado Family Trust',
    completed: false,
    tags: ['Onboarding'],
  },
  {
    id: 'task-7',
    title: 'File extension request',
    description: 'Submit Form 4868 before the deadline slips any further.',
    dueDate: isoInDays(-1),
    priorityId: 4,
    priorityLabel: 'Urgent',
    priorityColor: '#DC2626',
    priorityIcon: 'warning-outline',
    statusId: 2,
    statusLabel: 'In Progress',
    statusColor: '#3B82F6',
    assigneeName: 'You',
    clientName: 'Nguyen Enterprises',
    completed: false,
    tags: ['Extension'],
  },
  {
    id: 'task-8',
    title: 'Update client contact info',
    description: 'Sync the new billing address and phone number in the customer record.',
    dueDate: isoInDays(-5),
    priorityId: 1,
    priorityLabel: 'Low',
    priorityColor: '#10B981',
    priorityIcon: 'arrow-down-outline',
    statusId: 4,
    statusLabel: 'Completed',
    statusColor: '#10B981',
    assigneeName: 'James Cooper',
    clientName: 'Patel Consulting',
    completed: true,
    tags: ['Admin'],
  },
];

@Component({
  selector: 'app-dashboard-tasks',
  imports: [CommonModule, TaskModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-tasks.component.html',
  styleUrl: './dashboard-tasks.component.scss',
})
export class DashboardTasksComponent {
  readonly tasks = signal<Task[]>(INITIAL_TASKS);
  readonly filter = signal<TaskFilter>('all');

  readonly showTaskModal = signal(false);
  readonly editingTask = signal<Task | null>(null);

  readonly totalTasks = computed(() => this.tasks().length);
  readonly pendingTasks = computed(() => this.tasks().filter(task => !task.completed));
  readonly overdueTasks = computed(() => this.pendingTasks().filter(task => this.isOverdue(task.dueDate)));

  readonly visibleTasks = computed(() => {
    const pending = this.pendingTasks();
    switch (this.filter()) {
      case 'my':
        return pending.filter(task => task.assigneeName === 'You');
      case 'overdue':
        return pending.filter(task => this.isOverdue(task.dueDate));
      default:
        return pending;
    }
  });

  setFilter(filter: TaskFilter): void {
    this.filter.set(filter);
  }

  toggleComplete(taskId: string, event: Event): void {
    event.stopPropagation();
    this.tasks.update(list =>
      list.map(task => (task.id === taskId ? { ...task, completed: !task.completed } : task))
    );
  }

  openAddTask(): void {
    this.editingTask.set(null);
    this.showTaskModal.set(true);
  }

  openEditTask(task: Task): void {
    this.editingTask.set(task);
    this.showTaskModal.set(true);
  }

  closeTaskModal(): void {
    this.showTaskModal.set(false);
    this.editingTask.set(null);
  }

  handleTaskSave(data: TaskModalData): void {
    const editing = this.editingTask();
    const priority = this.priorityFor(data.priorityId);
    const status = this.statusFor(data.statusId);
    const clientName = data.assignmentType === 'customer' ? this.clientNameFor(data.customerId) : null;
    const assigneeName = data.assignmentType === 'team_member' ? this.assigneeNameFor(data.assignedToUserId) : 'Unassigned';

    if (editing) {
      this.tasks.update(list =>
        list.map(task =>
          task.id === editing.id
            ? {
                ...task,
                title: data.title,
                description: data.description,
                dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : task.dueDate,
                priorityId: priority.id,
                priorityLabel: priority.label,
                priorityColor: priority.color,
                statusId: status.id,
                statusLabel: status.label,
                statusColor: status.color,
                clientName,
                assigneeName,
                tags: data.tags,
              }
            : task
        )
      );
    } else {
      const newTask: Task = {
        id: `task-${Date.now()}`,
        title: data.title,
        description: data.description,
        dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : isoInDays(1),
        priorityId: priority.id,
        priorityLabel: priority.label,
        priorityColor: priority.color,
        priorityIcon: this.priorityIconFor(priority.id),
        statusId: status.id,
        statusLabel: status.label,
        statusColor: status.color,
        assigneeName,
        clientName,
        completed: false,
        tags: data.tags,
      };
      this.tasks.update(list => [newTask, ...list]);
    }

    this.closeTaskModal();
  }

  toTaskModalData(task: Task | null): TaskModalData | null {
    if (!task) {
      return null;
    }
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      dueDate: this.toDateTimeLocal(new Date(task.dueDate)),
      priorityId: task.priorityId,
      statusId: task.statusId,
      completionPercentage: task.completed ? 100 : 0,
      assignmentType: task.clientName ? 'customer' : task.assigneeName !== 'Unassigned' ? 'team_member' : 'none',
      customerId: null,
      assignedToUserId: null,
      tags: task.tags,
      reminders: [],
    };
  }

  isOverdue(dueDate: string): boolean {
    return new Date(dueDate).getTime() < Date.now();
  }

  formatDate(dateString: string): string {
    if (!dateString) {
      return '';
    }
    const date = new Date(dateString);
    const today = new Date();
    const diffTime = date.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays < -1) return `${Math.abs(diffDays)} days ago`;
    if (diffDays > 1) return `In ${diffDays} days`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  trackByTaskId(_index: number, task: Task): string {
    return task.id;
  }

  private priorityFor(priorityId: number): { id: number; label: string; color: string } {
    const map: Record<number, { label: string; color: string }> = {
      1: { label: 'Low', color: '#10B981' },
      2: { label: 'Medium', color: '#F59E0B' },
      3: { label: 'High', color: '#EF4444' },
      4: { label: 'Urgent', color: '#DC2626' },
    };
    return { id: priorityId, ...(map[priorityId] ?? map[2]) };
  }

  private priorityIconFor(priorityId: number): string {
    const map: Record<number, string> = {
      1: 'arrow-down-outline',
      2: 'remove-outline',
      3: 'arrow-up-outline',
      4: 'warning-outline',
    };
    return map[priorityId] ?? 'remove-outline';
  }

  private statusFor(statusId: number): { id: number; label: string; color: string } {
    const map: Record<number, { label: string; color: string }> = {
      1: { label: 'Not Started', color: '#6B7280' },
      2: { label: 'In Progress', color: '#3B82F6' },
      3: { label: 'Blocked', color: '#EF4444' },
      4: { label: 'Completed', color: '#10B981' },
      5: { label: 'Cancelled', color: '#DC2626' },
    };
    return { id: statusId, ...(map[statusId] ?? map[1]) };
  }

  private clientNameFor(customerId: string | null): string | null {
    const clients: Record<string, string> = {
      'cl-1': 'Johnson & Co LLC',
      'cl-2': 'Maria Alvarez',
      'cl-3': 'Sunrise Bakery Inc.',
      'cl-4': 'Robert Kim',
      'cl-5': 'Delgado Family Trust',
      'cl-6': 'Nguyen Enterprises',
      'cl-7': 'Patel Consulting',
    };
    return customerId ? clients[customerId] ?? null : null;
  }

  private assigneeNameFor(assignedToUserId: string | null): string {
    const members: Record<string, string> = {
      'tm-1': 'Sarah Mitchell',
      'tm-2': 'James Cooper',
      'tm-3': 'Elena Vargas',
      'tm-4': 'Marcus Chen',
    };
    return assignedToUserId ? members[assignedToUserId] ?? 'Unassigned' : 'Unassigned';
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
