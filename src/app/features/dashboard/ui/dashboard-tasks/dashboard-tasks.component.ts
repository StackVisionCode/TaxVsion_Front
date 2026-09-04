import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '@core/auth/auth.service';
import { TaskStore } from '../../../task/data-access/task.store';
import { ApiTaskPriority, TaskItem } from '../../../task/data-access/task.model';
import { formatRelativeDue, priorityChipClass } from '@core/tasks/task-format';
import { DashboardWidgetStateComponent } from '../dashboard-widget-state/dashboard-widget-state.component';

type TaskFilter = 'All' | 'My Tasks' | 'Overdue';

/** Cuántas tareas caben en el widget sin convertirlo en el tablero completo. */
const MAX_TASKS = 6;

/**
 * Widget "Tasks".
 *
 * Antes era una lista de 6 tareas inventadas ("Prepare Q2 tax filing" para
 * "Johnson & Co LLC"…) con fechas generadas al vuelo para que "pareciera
 * viva", y el checkbox solo cambiaba un booleano local.
 *
 * Ahora se alimenta del {@link TaskStore} real (`GET /tasks/board`, el mismo
 * que usa la página de Task): `init()` es idempotente, así que entrar al
 * dashboard y luego a Task no duplica peticiones. El checkbox llama a
 * `moveTask`, que es una transición de estado de verdad contra el backend
 * (optimista, con rollback si falla) — ya no es un adorno.
 *
 * Los filtros siguen siendo locales, pero ahora filtran datos reales:
 * "My Tasks" compara contra el id del usuario logueado y "Overdue" contra el
 * `dueDate` real de cada tarea.
 */
@Component({
  selector: 'app-dashboard-tasks',
  imports: [CommonModule, DashboardWidgetStateComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-tasks.component.html',
})
export class DashboardTasksComponent implements OnInit {
  private readonly store = inject(TaskStore);
  private readonly auth = inject(AuthService);

  readonly filters: TaskFilter[] = ['All', 'My Tasks', 'Overdue'];
  readonly filter = signal<TaskFilter>('All');

  readonly loading = this.store.loading;
  readonly error = this.store.error;
  /** Error de una acción concreta (mover una tarea), separado del error de carga. */
  readonly actionError = this.store.actionError;

  /** Tareas del filtro activo: primero las que vencen antes, luego sin fecha. */
  readonly visibleTasks = computed<TaskItem[]>(() => {
    const currentUserId = this.auth.currentUser()?.id ?? null;
    const tasks = this.store.tasks();

    const filtered = (() => {
      switch (this.filter()) {
        case 'My Tasks':
          return tasks.filter(task => !!currentUserId && task.assigneeUserId === currentUserId);
        case 'Overdue':
          return tasks.filter(task => this.isOverdue(task));
        default:
          return tasks;
      }
    })();

    return [...filtered]
      .sort((a, b) => {
        // Sin fecha van al final; entre las que tienen fecha, la más próxima primero.
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      })
      .slice(0, MAX_TASKS);
  });

  /** El estado vacío depende del filtro: "sin tareas" no es lo mismo que "nada vencido". */
  readonly emptyTitle = computed(() => {
    switch (this.filter()) {
      case 'My Tasks':
        return 'Nothing assigned to you';
      case 'Overdue':
        return "Nothing's overdue";
      default:
        return 'No tasks yet';
    }
  });

  ngOnInit(): void {
    this.store.init();
  }

  setFilter(filter: TaskFilter): void {
    this.filter.set(filter);
  }

  dismissActionError(): void {
    this.store.clearActionError();
  }

  trackByTaskId(_index: number, task: TaskItem): string {
    return task.id;
  }

  isCompleted(task: TaskItem): boolean {
    return task.status === 'completed';
  }

  /**
   * Transición real contra el backend: completar, o reabrir a "not started"
   * (la única transición de vuelta que acepta `moveTask` desde Completed).
   */
  toggleTask(task: TaskItem): void {
    this.store.moveTask(task.id, this.isCompleted(task) ? 'not-started' : 'completed');
  }

  isOverdue(task: TaskItem): boolean {
    if (!task.dueDate || this.isCompleted(task)) {
      return false;
    }
    return task.dueDate < this.todayIso();
  }

  /** "Today" / "Tomorrow" / "3 days ago"… — helper compartido (`@core/tasks/task-format`). */
  formatDue(dueDate: string): string {
    return formatRelativeDue(dueDate);
  }

  priorityChipClass(priority: ApiTaskPriority): string {
    return priorityChipClass(priority);
  }

  private todayIso(): string {
    const today = new Date();
    const month = `${today.getMonth() + 1}`.padStart(2, '0');
    const day = `${today.getDate()}`.padStart(2, '0');
    return `${today.getFullYear()}-${month}-${day}`;
  }
}
