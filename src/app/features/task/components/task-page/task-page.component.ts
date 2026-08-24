import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { TaskBoardComponent } from '../../ui/task-board/task-board.component';
import { TaskCreatePanelComponent } from '../../ui/task-create-panel/task-create-panel.component';
import { TaskStore } from '../../data-access/task.store';
import { ApiTaskPriority, TaskFormValue, TaskItem, TaskStatus } from '../../data-access/task.model';

type PriorityFilter = 'All' | ApiTaskPriority;

/**
 * Página del módulo Task conectada a Tasks.Api (/tasks vía Gateway): tablero
 * Kanban con stats + búsqueda server-side (/tasks/search) + filtro de prioridad
 * client-side + panel de creación/edición. Las transiciones de columna (drag o
 * puntos de la tarjeta) disparan los endpoints reales de transición con update
 * optimista; el guardado del panel lo orquesta TaskStore (create/update multi-paso).
 */
@Component({
  selector: 'app-task-page',
  imports: [CommonModule, FormsModule, TaskBoardComponent, TaskCreatePanelComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './task-page.component.html',
})
export class TaskPageComponent {
  readonly store = inject(TaskStore);

  readonly priorityFilters: PriorityFilter[] = ['All', 'Low', 'Normal', 'High', 'Urgent'];
  readonly activeFilter = signal<PriorityFilter>('All');

  readonly isPanelOpen = signal(false);
  readonly editingTask = signal<TaskItem | null>(null);
  readonly panelBusy = signal(false);
  readonly panelError = signal<string | null>(null);

  constructor() {
    this.store.init();
  }

  readonly totalCount = computed(() => this.store.tasks().length);

  readonly inProgressCount = computed(
    () => this.store.tasks().filter(task => task.status === 'in-progress').length,
  );

  readonly overdueCount = computed(
    () =>
      this.store
        .tasks()
        .filter(
          task =>
            task.status !== 'completed' && !!task.dueDate && new Date(task.dueDate).getTime() < Date.now(),
        ).length,
  );

  readonly completedThisWeekCount = computed(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return this.store
      .tasks()
      .filter(
        task =>
          task.status === 'completed' &&
          !!task.completedAtUtc &&
          new Date(task.completedAtUtc).getTime() >= weekAgo,
      ).length;
  });

  /** La búsqueda ya viene filtrada del servidor; acá solo se aplica el filtro de prioridad. */
  readonly visibleTasks = computed<TaskItem[]>(() => {
    const filter = this.activeFilter();
    const tasks = this.store.tasks();
    return filter === 'All' ? tasks : tasks.filter(task => task.priority === filter);
  });

  setFilter(filter: PriorityFilter): void {
    this.activeFilter.set(filter);
  }

  onSearchChange(term: string): void {
    this.store.setSearch(term);
  }

  retryLoad(): void {
    this.store.refresh();
  }

  openCreatePanel(): void {
    this.editingTask.set(null);
    this.panelError.set(null);
    this.isPanelOpen.set(true);
  }

  openEditPanel(task: TaskItem): void {
    this.editingTask.set(task);
    this.panelError.set(null);
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    if (this.panelBusy()) {
      return;
    }
    this.isPanelOpen.set(false);
    this.editingTask.set(null);
    this.panelError.set(null);
  }

  handleSaved(form: TaskFormValue): void {
    if (this.panelBusy()) {
      return;
    }
    const editing = this.editingTask();
    const action = editing ? this.store.updateTask(editing, form) : this.store.createTask(form);
    this.runPanelAction(action);
  }

  handleDeleted(task: TaskItem): void {
    if (this.panelBusy()) {
      return;
    }
    this.runPanelAction(this.store.deleteTask(task.id));
  }

  handleTaskCancelled(event: { task: TaskItem; reason: string }): void {
    if (this.panelBusy()) {
      return;
    }
    this.runPanelAction(this.store.cancelTask(event.task.id, event.reason));
  }

  changeStatus(event: { id: string; status: TaskStatus }): void {
    this.store.moveTask(event.id, event.status);
  }

  dismissActionError(): void {
    this.store.clearActionError();
  }

  private runPanelAction(action: ReturnType<TaskStore['createTask']>): void {
    this.panelBusy.set(true);
    this.panelError.set(null);
    action.subscribe({
      next: () => {
        this.panelBusy.set(false);
        this.isPanelOpen.set(false);
        this.editingTask.set(null);
      },
      error: err => {
        this.panelBusy.set(false);
        this.panelError.set(toApiError(err).message);
      },
    });
  }
}
