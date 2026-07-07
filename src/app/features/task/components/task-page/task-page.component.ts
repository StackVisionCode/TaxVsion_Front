import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskBoardComponent, TaskItem, TaskPriority, TaskStatus } from '../../ui/task-board/task-board.component';
import { TaskCreatePanelComponent } from '../../ui/task-create-panel/task-create-panel.component';

type PriorityFilter = 'All' | TaskPriority;

/** Builds a YYYY-MM-DD date string relative to today so the mock board always looks alive. */
function dateInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const SEED_TASKS: TaskItem[] = [
  {
    id: 'task-1',
    title: 'Prepare Q2 tax filing',
    description: 'Compile quarterly figures and prepare the Q2 estimated tax filing for review.',
    client: 'Johnson & Co LLC',
    dueDate: dateInDays(2),
    priority: 'High',
    status: 'in-progress',
    assigneeName: 'James Cooper',
    assigneeInitials: 'JC',
    assigneeColor: 'bg-indigo-500',
  },
  {
    id: 'task-2',
    title: 'Follow up on missing W-2 documents',
    description: 'Reach out to the client to request the outstanding W-2 from their previous employer.',
    client: 'Maria Alvarez',
    dueDate: dateInDays(1),
    priority: 'Medium',
    status: 'not-started',
    assigneeName: 'Elena Vargas',
    assigneeInitials: 'EV',
    assigneeColor: 'bg-orange-500',
  },
  {
    id: 'task-3',
    title: 'Review depreciation schedule',
    description: 'Verify the depreciation schedule for new equipment purchased this fiscal year.',
    client: 'Sunrise Bakery Inc.',
    dueDate: dateInDays(-2),
    priority: 'Urgent',
    status: 'blocked',
    assigneeName: 'You',
    assigneeInitials: 'ME',
    assigneeColor: 'bg-gray-900',
  },
  {
    id: 'task-4',
    title: 'Send engagement letter',
    description: 'Draft and send the 2026 engagement letter for e-signature.',
    client: 'Robert Kim',
    dueDate: dateInDays(5),
    priority: 'Low',
    status: 'not-started',
    assigneeName: 'Sarah Mitchell',
    assigneeInitials: 'SM',
    assigneeColor: 'bg-[#7C6AE0]',
  },
  {
    id: 'task-5',
    title: 'Client onboarding call',
    description: 'Kickoff call to gather entity details and prior year returns.',
    client: 'Delgado Family Trust',
    dueDate: dateInDays(0),
    priority: 'High',
    status: 'in-progress',
    assigneeName: 'Aisha Thompson',
    assigneeInitials: 'AT',
    assigneeColor: 'bg-emerald-500',
  },
  {
    id: 'task-6',
    title: 'File extension request',
    description: 'Submit Form 7004 before the deadline to avoid late filing penalties.',
    client: 'Nguyen Enterprises',
    dueDate: dateInDays(-1),
    priority: 'Urgent',
    status: 'blocked',
    assigneeName: 'You',
    assigneeInitials: 'ME',
    assigneeColor: 'bg-gray-900',
  },
  {
    id: 'task-7',
    title: 'Reconcile Q1 bank statements',
    description: 'Match bank feed transactions against the general ledger for Q1.',
    client: 'Summit Bakery Inc.',
    dueDate: dateInDays(-2),
    priority: 'Medium',
    status: 'completed',
    assigneeName: 'James Cooper',
    assigneeInitials: 'JC',
    assigneeColor: 'bg-indigo-500',
  },
  {
    id: 'task-8',
    title: 'Draft 1040-X amendment',
    description: 'Prepare the amended return to correct the reported dividend income.',
    client: 'Sarah Kim',
    dueDate: dateInDays(-3),
    priority: 'High',
    status: 'blocked',
    assigneeName: 'Elena Vargas',
    assigneeInitials: 'EV',
    assigneeColor: 'bg-orange-500',
  },
  {
    id: 'task-9',
    title: 'Organize client document uploads',
    description: 'Sort and label documents received through the client portal this month.',
    client: 'Marcus Webb',
    dueDate: dateInDays(7),
    priority: 'Low',
    status: 'not-started',
    assigneeName: 'You',
    assigneeInitials: 'ME',
    assigneeColor: 'bg-gray-900',
  },
  {
    id: 'task-10',
    title: 'Verify EIN application status',
    description: 'Check the IRS portal for the status of the new EIN application.',
    client: 'Webb Holdings',
    dueDate: dateInDays(4),
    priority: 'Medium',
    status: 'in-progress',
    assigneeName: 'Sarah Mitchell',
    assigneeInitials: 'SM',
    assigneeColor: 'bg-[#7C6AE0]',
  },
  {
    id: 'task-11',
    title: 'Prepare year-end payroll summary',
    description: 'Summarize payroll totals and benefits withholding for the year-end package.',
    client: 'Delgado Family Trust',
    dueDate: dateInDays(-10),
    priority: 'Low',
    status: 'completed',
    assigneeName: 'Aisha Thompson',
    assigneeInitials: 'AT',
    assigneeColor: 'bg-emerald-500',
  },
  {
    id: 'task-12',
    title: 'Schedule client review call',
    description: 'Set up a call to walk the client through the draft S-corp return.',
    client: 'Ferreira S-Corp',
    dueDate: dateInDays(10),
    priority: 'Medium',
    status: 'not-started',
    assigneeName: 'James Cooper',
    assigneeInitials: 'JC',
    assigneeColor: 'bg-indigo-500',
  },
];

/**
 * Página del módulo Task (estilo "Aether"): tablero Kanban con stats pastel +
 * filtros de prioridad/búsqueda + panel de creación/edición. Reemplaza al
 * sistema completo del CRM original (timers, recurrencia, dependencias,
 * comentarios/adjuntos) por una versión simplificada: todo el estado vive en
 * signals dentro de esta página, sin servicios ni backend. El movimiento de
 * estado entre columnas y el guardado del formulario son cambios locales
 * reales sobre la lista de tareas.
 */
@Component({
  selector: 'app-task-page',
  imports: [CommonModule, FormsModule, TaskBoardComponent, TaskCreatePanelComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './task-page.component.html',
})
export class TaskPageComponent {
  readonly tasks = signal<TaskItem[]>(SEED_TASKS);

  readonly priorityFilters: PriorityFilter[] = ['All', 'Low', 'Medium', 'High', 'Urgent'];
  readonly activeFilter = signal<PriorityFilter>('All');
  readonly search = signal('');

  readonly isPanelOpen = signal(false);
  readonly editingTask = signal<TaskItem | null>(null);

  readonly totalCount = computed(() => this.tasks().length);

  readonly inProgressCount = computed(() => this.tasks().filter(task => task.status === 'in-progress').length);

  readonly overdueCount = computed(
    () => this.tasks().filter(task => task.status !== 'completed' && new Date(task.dueDate).getTime() < Date.now())
      .length,
  );

  readonly completedThisWeekCount = computed(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return this.tasks().filter(task => task.status === 'completed' && new Date(task.dueDate).getTime() >= weekAgo)
      .length;
  });

  readonly visibleTasks = computed<TaskItem[]>(() => {
    const query = this.search().trim().toLowerCase();
    const filter = this.activeFilter();
    return this.tasks().filter(task => {
      const matchesFilter = filter === 'All' || task.priority === filter;
      const matchesSearch =
        !query || task.title.toLowerCase().includes(query) || task.client.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  });

  setFilter(filter: PriorityFilter): void {
    this.activeFilter.set(filter);
  }

  openCreatePanel(): void {
    this.editingTask.set(null);
    this.isPanelOpen.set(true);
  }

  openEditPanel(task: TaskItem): void {
    this.editingTask.set(task);
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    this.isPanelOpen.set(false);
    this.editingTask.set(null);
  }

  handleSaved(task: TaskItem): void {
    this.tasks.update(list => {
      const exists = list.some(item => item.id === task.id);
      return exists ? list.map(item => (item.id === task.id ? task : item)) : [...list, task];
    });
    this.closePanel();
  }

  changeStatus(event: { id: string; status: TaskStatus }): void {
    this.tasks.update(list =>
      list.map(task => (task.id === event.id ? { ...task, status: event.status } : task)),
    );
  }
}
