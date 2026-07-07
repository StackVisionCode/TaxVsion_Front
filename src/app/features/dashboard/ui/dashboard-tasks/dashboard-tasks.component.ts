import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

type TaskFilter = 'All' | 'My Tasks' | 'Overdue';
type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

interface DashboardTask {
  id: string;
  title: string;
  client: string | null;
  dueDate: string; // ISO datetime string
  priority: TaskPriority;
  assignee: string;
  completed: boolean;
}

/** Builds an ISO date relative to today so the mock list always looks alive. */
function isoInDays(days: number, hour = 17): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

const INITIAL_TASKS: DashboardTask[] = [
  {
    id: 'task-1',
    title: 'Prepare Q2 tax filing',
    client: 'Johnson & Co LLC',
    dueDate: isoInDays(2),
    priority: 'High',
    assignee: 'You',
    completed: false,
  },
  {
    id: 'task-2',
    title: 'Follow up on missing W-2 documents',
    client: 'Maria Alvarez',
    dueDate: isoInDays(1),
    priority: 'Medium',
    assignee: 'James Cooper',
    completed: false,
  },
  {
    id: 'task-3',
    title: 'Review depreciation schedule',
    client: 'Sunrise Bakery Inc.',
    dueDate: isoInDays(-2),
    priority: 'Urgent',
    assignee: 'You',
    completed: false,
  },
  {
    id: 'task-4',
    title: 'Send engagement letter',
    client: 'Robert Kim',
    dueDate: isoInDays(5),
    priority: 'Low',
    assignee: 'Elena Vargas',
    completed: false,
  },
  {
    id: 'task-5',
    title: 'Client onboarding call',
    client: 'Delgado Family Trust',
    dueDate: isoInDays(0),
    priority: 'High',
    assignee: 'Sarah Mitchell',
    completed: false,
  },
  {
    id: 'task-6',
    title: 'File extension request',
    client: 'Nguyen Enterprises',
    dueDate: isoInDays(-1),
    priority: 'Urgent',
    assignee: 'You',
    completed: false,
  },
];

/**
 * Widget "Tasks" (referencia "Aether"): lista plana de tareas con checkbox
 * redondo, chips de prioridad en contorno y tabs píldora (All / My Tasks /
 * Overdue) con filtrado local real. Datos estáticos, sin backend ni modal.
 */
@Component({
  selector: 'app-dashboard-tasks',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-tasks.component.html',
})
export class DashboardTasksComponent {
  readonly filters: TaskFilter[] = ['All', 'My Tasks', 'Overdue'];

  readonly tasks = signal<DashboardTask[]>(INITIAL_TASKS);
  readonly filter = signal<TaskFilter>('All');

  readonly visibleTasks = computed<DashboardTask[]>(() => {
    const tasks = this.tasks();
    switch (this.filter()) {
      case 'My Tasks':
        return tasks.filter(task => task.assignee === 'You');
      case 'Overdue':
        return tasks.filter(task => !task.completed && this.isOverdue(task));
      default:
        return tasks;
    }
  });

  setFilter(filter: TaskFilter): void {
    this.filter.set(filter);
  }

  toggleTask(taskId: string): void {
    this.tasks.update(list =>
      list.map(task => (task.id === taskId ? { ...task, completed: !task.completed } : task)),
    );
  }

  isOverdue(task: DashboardTask): boolean {
    return new Date(task.dueDate).getTime() < Date.now();
  }

  formatDue(dueDate: string): string {
    const due = new Date(dueDate);
    const today = new Date();
    due.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays < -1) return `${Math.abs(diffDays)} days ago`;
    return `In ${diffDays} days`;
  }

  priorityChipClass(priority: TaskPriority): string {
    switch (priority) {
      case 'Urgent':
        return 'border-red-200 text-red-500';
      case 'High':
        return 'border-orange-200 text-orange-500';
      case 'Medium':
        return 'border-amber-200 text-amber-600';
      case 'Low':
        return 'border-gray-200 text-gray-500';
    }
  }
}
