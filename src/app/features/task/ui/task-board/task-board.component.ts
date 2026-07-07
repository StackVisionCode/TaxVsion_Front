import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';

export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';
export type TaskStatus = 'not-started' | 'in-progress' | 'blocked' | 'completed';

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  client: string;
  dueDate: string; // ISO date (YYYY-MM-DD)
  priority: TaskPriority;
  status: TaskStatus;
  assigneeName: string;
  assigneeInitials: string;
  assigneeColor: string;
}

export interface StatusColumn {
  id: TaskStatus;
  label: string;
  dotClass: string;
}

export const TASK_COLUMNS: StatusColumn[] = [
  { id: 'not-started', label: 'Not Started', dotClass: 'bg-gray-400' },
  { id: 'in-progress', label: 'In Progress', dotClass: 'bg-[#7C6AE0]' },
  { id: 'blocked', label: 'Blocked', dotClass: 'bg-red-500' },
  { id: 'completed', label: 'Completed', dotClass: 'bg-emerald-500' },
];

/**
 * Tablero Kanban del módulo Task (estilo "Aether"): 4 columnas fijas (Not
 * Started / In Progress / Blocked / Completed) con drag-and-drop (CDK). Cada
 * tarjeta se puede arrastrar a otra columna para cambiar su estado, con
 * animación de recolocación suave; los 4 puntos de la tarjeta siguen sirviendo
 * como atajo para mover por click.
 *
 * Las columnas se materializan en "buckets" locales que se reconstruyen en
 * `ngOnChanges` a partir del @Input. Al soltar en otra columna se mutan los
 * buckets de forma optimista (para que el CDK anime sin "volver atrás") y se
 * emite el cambio de estado al padre; cuando el signal del padre se actualiza,
 * el nuevo @Input reconstruye los buckets al mismo estado, sin parpadeo.
 */
@Component({
  selector: 'app-task-board',
  imports: [CommonModule, DragDropModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './task-board.component.html',
  styleUrl: './task-board.component.css',
})
export class TaskBoardComponent implements OnChanges {
  @Input() tasks: TaskItem[] = [];
  @Output() taskOpened = new EventEmitter<TaskItem>();
  @Output() statusChanged = new EventEmitter<{ id: string; status: TaskStatus }>();

  readonly columns = TASK_COLUMNS;

  /** Ids de los cdkDropList para conectarlos entre sí (drag entre columnas). */
  readonly dropListIds = TASK_COLUMNS.map(column => `task-col-${column.id}`);

  /** Buckets locales por columna; referencias estables entre ciclos de CD (clave para el CDK). */
  private readonly buckets = new Map<TaskStatus, TaskItem[]>(
    TASK_COLUMNS.map(column => [column.id, [] as TaskItem[]]),
  );

  /** Flag para no abrir el panel de edición justo después de arrastrar una tarjeta. */
  private justDragged = false;

  ngOnChanges(): void {
    for (const column of this.columns) {
      const next = this.tasks.filter(task => task.status === column.id);
      const bucket = this.buckets.get(column.id)!;
      // Conserva el ORDEN actual del bucket para las tareas que siguen en la
      // columna (si no, la tarjeta recién soltada "saltaría" a su posición del
      // orden original del seed justo después del drop) y agrega al final las
      // nuevas. Se muta con splice para conservar la referencia (data del CDK).
      const nextById = new Map(next.map(task => [task.id, task]));
      const kept = bucket
        .filter(task => nextById.has(task.id))
        .map(task => nextById.get(task.id)!);
      const keptIds = new Set(kept.map(task => task.id));
      const added = next.filter(task => !keptIds.has(task.id));
      bucket.splice(0, bucket.length, ...kept, ...added);
    }
  }

  bucketFor(columnId: TaskStatus): TaskItem[] {
    return this.buckets.get(columnId) ?? [];
  }

  dropListIdFor(columnId: TaskStatus): string {
    return `task-col-${columnId}`;
  }

  onDrop(event: CdkDragDrop<TaskItem[]>, targetStatus: TaskStatus): void {
    if (event.previousContainer === event.container) {
      // Reordenar dentro de la misma columna (solo visual, no cambia el estado).
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      return;
    }

    // Mover a otra columna: mutación optimista + emitir el cambio de estado real.
    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      event.currentIndex,
    );
    const task = event.item.data as TaskItem;
    this.statusChanged.emit({ id: task.id, status: targetStatus });
  }

  onDragEnded(): void {
    // El click se dispara después del pointerup; lo suprimimos brevemente tras un drag.
    this.justDragged = true;
    setTimeout(() => (this.justDragged = false), 0);
  }

  openTask(task: TaskItem): void {
    if (this.justDragged) {
      return;
    }
    this.taskOpened.emit(task);
  }

  moveTask(task: TaskItem, status: TaskStatus, event: Event): void {
    event.stopPropagation();
    if (task.status === status) {
      return;
    }
    this.statusChanged.emit({ id: task.id, status });
  }

  isOverdue(task: TaskItem): boolean {
    return task.status !== 'completed' && new Date(task.dueDate).getTime() < Date.now();
  }

  formatDue(dueDate: string): string {
    const due = new Date(`${dueDate}T00:00:00`);
    const today = new Date();
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
        return 'border-emerald-200 text-emerald-600';
    }
  }

  trackByTaskId(_index: number, task: TaskItem): string {
    return task.id;
  }
}
