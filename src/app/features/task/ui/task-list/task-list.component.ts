import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiTaskPriority, TaskItem, TaskStatus } from '../../data-access/task.model';
import { formatRelativeDue, priorityChipClass } from '@core/tasks/task-format';

type SortKey = 'due' | 'priority' | 'title';

/**
 * Vista LISTA del módulo Task — alternativa densa al tablero para escanear volumen. Presentacional
 * puro (mismo contrato de I/O que el board: `@Input tasks`, `@Output taskOpened/statusChanged`), así
 * la página alterna board/lista sin tocar el store. Orden client-side por fecha/prioridad/título.
 */
@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './task-list.component.html',
  styleUrl: './task-list.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskListComponent {
  @Input() tasks: TaskItem[] = [];

  @Output() taskOpened = new EventEmitter<TaskItem>();
  @Output() statusChanged = new EventEmitter<{ id: string; status: TaskStatus }>();

  readonly sortKey = signal<SortKey>('due');
  readonly sortAsc = signal(true);

  private readonly priorityRank: Record<ApiTaskPriority, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

  readonly sorted = computed(() => {
    const key = this.sortKey();
    const dir = this.sortAsc() ? 1 : -1;
    return [...this.tasks].sort((a, b) => dir * this.compare(a, b, key));
  });

  private compare(a: TaskItem, b: TaskItem, key: SortKey): number {
    if (key === 'title') {
      return a.title.localeCompare(b.title);
    }
    if (key === 'priority') {
      return this.priorityRank[a.priority] - this.priorityRank[b.priority];
    }
    // due: sin fecha va al final
    const av = a.dueDate || '9999-12-31';
    const bv = b.dueDate || '9999-12-31';
    return av.localeCompare(bv);
  }

  setSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortAsc.update(v => !v);
    } else {
      this.sortKey.set(key);
      this.sortAsc.set(true);
    }
  }

  open(task: TaskItem): void {
    this.taskOpened.emit(task);
  }

  toggleComplete(task: TaskItem, event: Event): void {
    event.stopPropagation();
    this.statusChanged.emit({ id: task.id, status: task.status === 'completed' ? 'not-started' : 'completed' });
  }

  isOverdue(task: TaskItem): boolean {
    return !!task.dueDate && task.status !== 'completed' && new Date(task.dueDate).getTime() < Date.now();
  }

  formatDue(dueDate: string): string {
    return formatRelativeDue(dueDate);
  }

  priorityChip(priority: ApiTaskPriority): string {
    return priorityChipClass(priority);
  }

  trackById(_i: number, task: TaskItem): string {
    return task.id;
  }
}
