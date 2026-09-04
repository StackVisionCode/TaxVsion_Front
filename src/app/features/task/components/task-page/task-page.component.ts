import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { TaskBoardComponent } from '../../ui/task-board/task-board.component';
import { TaskCreatePanelComponent } from '../../ui/task-create-panel/task-create-panel.component';
import { TaskDetailDrawerComponent } from '../../ui/task-detail-drawer/task-detail-drawer.component';
import { TaskListComponent } from '../../ui/task-list/task-list.component';
import { TaskCalendarComponent } from '../../ui/task-calendar/task-calendar.component';
import { TaskTemplatesModalComponent } from '../../ui/task-templates-modal/task-templates-modal.component';
import { TaskSeriesModalComponent } from '../../ui/task-series-modal/task-series-modal.component';
import { TaskLabelsModalComponent } from '../../ui/task-labels-modal/task-labels-modal.component';
import { TaskCalendarEntry, statusToColumn } from '../../data-access/task.model';
import { TaskStore } from '../../data-access/task.store';
import { ApiTaskPriority, TaskFormValue, TaskItem, TaskStatus } from '../../data-access/task.model';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { ToastService } from '@shared/ui/toast/toast.service';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';

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
  imports: [
    CommonModule,
    FormsModule,
    TaskBoardComponent,
    TaskListComponent,
    TaskCalendarComponent,
    TaskTemplatesModalComponent,
    TaskSeriesModalComponent,
    TaskLabelsModalComponent,
    TaskCreatePanelComponent,
    TaskDetailDrawerComponent,
    PaginationComponent,
    HasPermissionDirective,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './task-page.component.html',
})
export class TaskPageComponent {
  readonly store = inject(TaskStore);
  private readonly toast = inject(ToastService);

  readonly priorityFilters: PriorityFilter[] = ['All', 'Low', 'Normal', 'High', 'Urgent'];
  readonly activeFilter = signal<PriorityFilter>('All');

  /** Board (flujo) · List (volumen) · Calendar (por vencimiento). Persistido en localStorage. */
  readonly viewMode = signal<'board' | 'list' | 'calendar'>(this.readViewMode());

  private readViewMode(): 'board' | 'list' | 'calendar' {
    try {
      const v = localStorage.getItem('task_view_mode');
      return v === 'list' || v === 'calendar' ? v : 'board';
    } catch {
      return 'board';
    }
  }

  setViewMode(mode: 'board' | 'list' | 'calendar'): void {
    this.viewMode.set(mode);
    try {
      localStorage.setItem('task_view_mode', mode);
    } catch {
      /* sin persistencia: vive en memoria */
    }
  }

  readonly isPanelOpen = signal(false);
  readonly editingTask = signal<TaskItem | null>(null);
  readonly panelBusy = signal(false);
  readonly panelError = signal<string | null>(null);

  /** Tarea abierta en el drawer de detalle (null = cerrado). El click en una tarjeta abre el drawer. */
  readonly drawerTask = signal<TaskItem | null>(null);

  readonly isTemplatesOpen = signal(false);
  readonly isSeriesOpen = signal(false);
  readonly isLabelsOpen = signal(false);

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

  onSearchPageChange(page: number): void {
    this.store.setSearchPage(page);
  }

  // ----- Filtros server-side -----
  setCustomerFilter(id: string): void {
    this.store.setFilters({ customer: id || null });
  }

  setAssigneeFilter(id: string): void {
    this.store.setFilters({ assignee: id || null });
  }

  setTaxYearFilter(year: string): void {
    const n = parseInt(year, 10);
    this.store.setFilters({ taxYear: Number.isNaN(n) ? null : n });
  }

  clearFilters(): void {
    this.store.clearFilters();
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

  /** Click en una tarjeta del tablero → abre el drawer de detalle (read-only + "Edit"). */
  openDrawer(task: TaskItem): void {
    this.drawerTask.set(task);
  }

  /** Click en una tarea del calendario: reusa el TaskItem del store si está, si no arma uno mínimo. */
  openFromCalendar(entry: TaskCalendarEntry): void {
    const existing = this.store.tasks().find(t => t.id === entry.id);
    if (existing) {
      this.drawerTask.set(existing);
      return;
    }
    const column = statusToColumn(entry.status);
    this.drawerTask.set({
      id: entry.id,
      title: entry.title,
      description: '',
      client: '',
      customerId: entry.customerId,
      dueDate: entry.dueAtUtc.slice(0, 10),
      dueIsStatutory: entry.isStatutory,
      priority: entry.priority,
      status: column ?? 'not-started',
      apiStatus: entry.status,
      assigneeUserId: entry.assigneeUserId,
      assigneeName: entry.assigneeUserId ? 'Team member' : 'Unassigned',
      assigneeInitials: entry.assigneeUserId ? '—' : '—',
      assigneeColor: 'bg-gray-300',
      isBlocked: entry.isBlocked,
      taxYear: null,
      estimatedHours: null,
      expectedItems: '',
      completedAtUtc: null,
    });
  }

  closeDrawer(): void {
    this.drawerTask.set(null);
  }

  /** El drawer cambió algo del backend (subtarea, dependencia) → refrescar el tablero. */
  onDrawerChanged(): void {
    this.store.refresh();
  }

  openTemplates(): void {
    this.isTemplatesOpen.set(true);
  }

  closeTemplates(): void {
    this.isTemplatesOpen.set(false);
  }

  onTemplateApplied(): void {
    this.store.refresh();
  }

  openSeries(): void {
    this.isSeriesOpen.set(true);
  }

  closeSeries(): void {
    this.isSeriesOpen.set(false);
  }

  openLabels(): void {
    this.isLabelsOpen.set(true);
  }

  closeLabels(): void {
    this.isLabelsOpen.set(false);
    // Pudo cambiar el catálogo → refrescar los renombres de columna del tablero.
    this.store.loadTaxonomies();
  }

  /** El drawer pidió editar → cierra el drawer y abre el panel de edición existente. */
  editFromDrawer(task: TaskItem): void {
    this.drawerTask.set(null);
    this.openEditPanel(task);
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
    this.runPanelAction(action, editing ? 'Task updated' : 'Task created');
  }

  handleDeleted(task: TaskItem): void {
    if (this.panelBusy()) {
      return;
    }
    this.runPanelAction(this.store.deleteTask(task.id), 'Task deleted');
  }

  handleTaskCancelled(event: { task: TaskItem; reason: string }): void {
    if (this.panelBusy()) {
      return;
    }
    this.runPanelAction(this.store.cancelTask(event.task.id, event.reason), 'Task cancelled');
  }

  changeStatus(event: { id: string; status: TaskStatus }): void {
    this.store.moveTask(event.id, event.status);
  }

  dismissActionError(): void {
    this.store.clearActionError();
  }

  private runPanelAction(action: ReturnType<TaskStore['createTask']>, successMessage: string): void {
    this.panelBusy.set(true);
    this.panelError.set(null);
    action.subscribe({
      next: () => {
        this.panelBusy.set(false);
        this.isPanelOpen.set(false);
        this.editingTask.set(null);
        this.toast.success(successMessage);
      },
      error: err => {
        this.panelBusy.set(false);
        this.panelError.set(toApiError(err).message);
      },
    });
  }
}
