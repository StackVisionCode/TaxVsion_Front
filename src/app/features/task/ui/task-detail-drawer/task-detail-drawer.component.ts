import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { TaskService } from '../../data-access/task.service';
import {
  ApiTaskPriority,
  ApiTaskStatus,
  TaskAttachmentResponse,
  TaskItem,
  TaskResponse,
  TaskTimerResponse,
} from '../../data-access/task.model';
import { priorityChipClass } from '@core/tasks/task-format';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { formatBytes } from '@core/cloud-storage/cloud-storage.model';

interface SubtaskRow {
  id: string;
  title: string;
  status: ApiTaskStatus;
  done: boolean;
}

interface BlockerRow {
  id: string;
  title: string;
  status: ApiTaskStatus;
}

/**
 * Drawer (slide-over derecha) con el detalle COMPLETO de una tarea. Superficie contenedora de F3:
 * surface todos los campos que el tablero descartaba (timestamps, horas estimadas/reales, contadores
 * de subtareas/bloqueos, tax year, fecha estatutaria, datos de WaitOnClient) + el grafo de
 * dependencias (para el badge "Bloqueada por N"). Las secciones de subtareas / adjuntos / tiempo se
 * llenan en fases posteriores (F4/F5/F10). Read-only + "Edit details" abre el panel existente.
 *
 * Sin `@angular/animations` (no es dependencia): entrada/salida por CSS con `prefers-reduced-motion`.
 */
@Component({
  selector: 'app-task-detail-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './task-detail-drawer.component.html',
  styleUrl: './task-detail-drawer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskDetailDrawerComponent implements OnChanges {
  private readonly service = inject(TaskService);
  private readonly auth = inject(AuthService);
  private readonly cloud = inject(CloudStorageUploadService);

  /** Tarjeta del tablero (nombres ya resueltos). null = drawer cerrado. */
  @Input() task: TaskItem | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() editRequested = new EventEmitter<TaskItem>();
  /** Algo cambió que afecta al tablero (subtarea completada, dependencia) → el padre refresca. */
  @Output() changed = new EventEmitter<void>();

  readonly detail = signal<TaskResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** IDs de las tareas que bloquean a esta (aristas del grafo hacia arriba). */
  readonly blockerIds = signal<string[]>([]);

  // ----- Subtareas -----
  readonly subtasks = signal<SubtaskRow[]>([]);
  readonly subtasksLoading = signal(false);
  readonly newSubtaskTitle = signal('');
  readonly addingSubtask = signal(false);

  // ----- Dependencias -----
  readonly blockers = signal<BlockerRow[]>([]);
  readonly depSearch = signal('');
  readonly depResults = signal<{ id: string; title: string }[]>([]);
  readonly depSearching = signal(false);
  private depSearchTimer: ReturnType<typeof setTimeout> | null = null;

  // ----- Adjuntos -----
  readonly attachments = signal<TaskAttachmentResponse[]>([]);
  readonly attachmentsLoading = signal(false);
  readonly uploadingAttachment = signal(false);

  // ----- Tiempo -----
  readonly timers = signal<TaskTimerResponse[]>([]);
  readonly timerBusy = signal(false);
  /** Mi timer corriendo en esta tarea (sin stop), o null. */
  readonly myRunningTimer = computed(() => {
    const uid = this.auth.currentUser()?.id ?? null;
    return this.timers().find(t => t.userId === uid && !t.stoppedAtUtc) ?? null;
  });
  readonly loggedMinutes = computed(() =>
    this.timers().reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0),
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['task']) {
      const task = this.task;
      if (task) {
        this.fetch(task.id);
      } else {
        this.detail.set(null);
        this.error.set(null);
        this.blockerIds.set([]);
      }
    }
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.detail.set(null);
    this.blockerIds.set([]);
    this.subtasks.set([]);
    this.blockers.set([]);
    this.depResults.set([]);
    this.depSearch.set('');
    this.service.getById(id).subscribe({
      next: detail => {
        this.detail.set(detail);
        this.loading.set(false);
      },
      error: () => {
        this.error.set("We couldn't load this task's details.");
        this.loading.set(false);
      },
    });
    this.loadSubtasks(id);
    this.loadBlockers(id);
    this.loadAttachments(id);
    this.loadTimers(id);
  }

  private loadTimers(id: string): void {
    this.service.timers(id).subscribe({
      next: rows => this.timers.set(rows),
      error: () => this.timers.set([]),
    });
  }

  toggleTimer(): void {
    const task = this.task;
    if (!task || this.timerBusy()) {
      return;
    }
    this.timerBusy.set(true);
    const running = this.myRunningTimer();
    const op = running
      ? this.service.stopTimer(task.id, running.id)
      : this.service.startTimer(task.id, { isBillable: true });
    op.subscribe({
      next: () => {
        this.timerBusy.set(false);
        this.loadTimers(task.id);
      },
      error: () => {
        this.timerBusy.set(false);
        this.loadTimers(task.id);
      },
    });
  }

  /** minutos → "2h 15m". */
  formatMinutes(min: number): string {
    if (min <= 0) return '0m';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  private loadAttachments(id: string): void {
    this.attachmentsLoading.set(true);
    this.service.attachments(id).subscribe({
      next: rows => {
        // Ocultar los detached (el byte se fue de CloudStorage).
        this.attachments.set(rows.filter(a => a.status !== 'Detached'));
        this.attachmentsLoading.set(false);
      },
      error: () => this.attachmentsLoading.set(false),
    });
  }

  /**
   * Sube un archivo: el byte va a CloudStorage con el token del usuario y a Tasks solo el fileId
   * (nace Pending hasta el veredicto del escaneo). Owner: el cliente de la tarea si lo tiene, si no
   * el usuario; folder 'Tasks'. (Convención a confirmar en E2E — CloudStorage no tiene owner 'Task'.)
   */
  async uploadAttachment(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const task = this.task;
    if (!file || !task || this.uploadingAttachment()) {
      input.value = '';
      return;
    }
    this.uploadingAttachment.set(true);
    try {
      const ownerId = task.customerId ?? this.auth.currentUser()?.id ?? null;
      const ownerType = task.customerId ? 'Customer' : 'User';
      const initiated = await firstValueFrom(
        this.cloud.initiateUpload({
          originalName: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          ownerType,
          ownerId,
          folderType: 'Tasks',
          taxYear: task.taxYear,
        }),
      );
      await firstValueFrom(this.cloud.uploadToPresignedUrl(initiated.uploadUrl, initiated.formData, file));
      await firstValueFrom(this.cloud.completeUpload(initiated.fileId));
      await firstValueFrom(
        this.service.uploadAttachment(task.id, {
          fileId: initiated.fileId,
          displayName: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      );
      this.loadAttachments(task.id);
    } catch {
      // El error del backend (p.ej. 20 adjuntos activos) se refleja al recargar; sin toast en el drawer.
      this.loadAttachments(task.id);
    } finally {
      this.uploadingAttachment.set(false);
      input.value = '';
    }
  }

  removeAttachment(fileId: string): void {
    const task = this.task;
    if (!task) {
      return;
    }
    this.attachments.update(list => list.filter(a => a.fileId !== fileId));
    this.service.deleteAttachment(task.id, fileId).subscribe({
      next: () => this.loadAttachments(task.id),
      error: () => this.loadAttachments(task.id),
    });
  }

  attachmentSize(bytes: number): string {
    return formatBytes(bytes);
  }

  attachmentStatusLabel(status: string): string {
    switch (status) {
      case 'Pending':
        return 'Processing…';
      case 'Available':
        return 'Ready';
      case 'Rejected':
        return 'Rejected';
      default:
        return status;
    }
  }

  attachmentStatusColor(status: string): string {
    switch (status) {
      case 'Available':
        return 'text-emerald-600';
      case 'Rejected':
        return 'text-red-600';
      case 'Pending':
        return 'text-amber-600';
      default:
        return 'text-gray-400';
    }
  }

  private loadSubtasks(id: string): void {
    this.subtasksLoading.set(true);
    this.service.subtasks(id).subscribe({
      next: page => {
        this.subtasks.set(page.items.map(t => this.toSubtaskRow(t)));
        this.subtasksLoading.set(false);
      },
      error: () => this.subtasksLoading.set(false),
    });
  }

  /** Resuelve el grafo → blockers con título (una llamada getById por bloqueador; N chico). */
  private loadBlockers(id: string): void {
    this.service.graph(id).subscribe({
      next: graph => {
        const ids = graph.edges.filter(e => e.taskId === id).map(e => e.dependsOnTaskId);
        this.blockerIds.set(ids);
        if (ids.length === 0) {
          this.blockers.set([]);
          return;
        }
        forkJoin(
          ids.map(bid =>
            this.service.getById(bid).pipe(
              map(t => ({ id: t.id, title: t.title, status: t.status }) as BlockerRow),
              catchError(() => of({ id: bid, title: 'Task', status: 'NotStarted' as ApiTaskStatus })),
            ),
          ),
        ).subscribe(rows => this.blockers.set(rows));
      },
      error: () => {
        this.blockerIds.set([]);
        this.blockers.set([]);
      },
    });
  }

  private toSubtaskRow(t: TaskResponse): SubtaskRow {
    return { id: t.id, title: t.title, status: t.status, done: t.status === 'Completed' };
  }

  // ----- Acciones de subtareas -----

  addSubtask(): void {
    const task = this.task;
    const title = this.newSubtaskTitle().trim();
    if (!task || !title || this.addingSubtask()) {
      return;
    }
    this.addingSubtask.set(true);
    this.service
      .createSubtask(task.id, {
        title,
        description: null,
        priority: 'Normal',
        assigneeUserId: null,
        dueAtUtc: null,
        dueTimeZoneId: null,
        dueIsStatutory: false,
        estimatedHours: null,
      })
      .subscribe({
        next: created => {
          this.subtasks.update(list => [...list, this.toSubtaskRow(created)]);
          this.newSubtaskTitle.set('');
          this.addingSubtask.set(false);
          this.bumpSubtaskCount(+1);
          this.changed.emit();
        },
        error: () => this.addingSubtask.set(false),
      });
  }

  toggleSubtask(row: SubtaskRow): void {
    const op = row.done ? this.service.reopen(row.id) : this.service.complete(row.id);
    // Optimista.
    this.subtasks.update(list =>
      list.map(s => (s.id === row.id ? { ...s, done: !s.done, status: s.done ? 'NotStarted' : 'Completed' } : s)),
    );
    op.subscribe({
      next: updated =>
        this.subtasks.update(list => list.map(s => (s.id === row.id ? this.toSubtaskRow(updated) : s))),
      error: () =>
        // Rollback.
        this.subtasks.update(list =>
          list.map(s => (s.id === row.id ? { ...s, done: row.done, status: row.status } : s)),
        ),
    });
    this.changed.emit();
  }

  private bumpSubtaskCount(delta: number): void {
    const d = this.detail();
    if (d) {
      this.detail.set({ ...d, openSubtaskCount: Math.max(0, d.openSubtaskCount + delta) });
    }
  }

  // ----- Acciones de dependencias -----

  onDepSearch(term: string): void {
    this.depSearch.set(term);
    if (this.depSearchTimer) {
      clearTimeout(this.depSearchTimer);
    }
    const q = term.trim();
    if (q.length < 2) {
      this.depResults.set([]);
      return;
    }
    this.depSearching.set(true);
    this.depSearchTimer = setTimeout(() => {
      this.service.search({ q, size: 8 }).subscribe({
        next: page => {
          const selfId = this.task?.id;
          const blocked = new Set(this.blockerIds());
          this.depResults.set(
            page.items
              .filter(t => t.id !== selfId && !blocked.has(t.id))
              .map(t => ({ id: t.id, title: t.title })),
          );
          this.depSearching.set(false);
        },
        error: () => this.depSearching.set(false),
      });
    }, 300);
  }

  addDependency(dependsOnTaskId: string): void {
    const task = this.task;
    if (!task) {
      return;
    }
    this.service.addDependency(task.id, { dependsOnTaskId }).subscribe({
      next: () => {
        this.depSearch.set('');
        this.depResults.set([]);
        this.loadBlockers(task.id);
        this.changed.emit();
      },
      error: () => this.loadBlockers(task.id),
    });
  }

  removeDependency(dependsOnTaskId: string): void {
    const task = this.task;
    if (!task) {
      return;
    }
    // Optimista.
    this.blockers.update(list => list.filter(b => b.id !== dependsOnTaskId));
    this.service.removeDependency(task.id, dependsOnTaskId).subscribe({
      next: () => {
        this.loadBlockers(task.id);
        this.changed.emit();
      },
      error: () => this.loadBlockers(task.id),
    });
  }

  close(): void {
    this.closed.emit();
  }

  edit(): void {
    if (this.task) {
      this.editRequested.emit(this.task);
    }
  }

  priorityChip(priority: ApiTaskPriority): string {
    return priorityChipClass(priority);
  }

  statusLabel(status: ApiTaskStatus): string {
    switch (status) {
      case 'NotStarted':
        return 'Not started';
      case 'InProgress':
        return 'In progress';
      case 'WaitingOnClient':
        return 'Waiting on client';
      case 'Completed':
        return 'Completed';
      case 'Cancelled':
        return 'Cancelled';
    }
  }

  statusColor(status: ApiTaskStatus): string {
    switch (status) {
      case 'NotStarted':
        return 'bg-gray-100 text-gray-600';
      case 'InProgress':
        return 'bg-indigo-100 text-indigo-700';
      case 'WaitingOnClient':
        return 'bg-amber-100 text-amber-700';
      case 'Completed':
        return 'bg-emerald-100 text-emerald-700';
      case 'Cancelled':
        return 'bg-gray-100 text-gray-400';
    }
  }

  /** ISO → "Mar 5, 2026, 3:30 PM" en la zona del navegador; '' si null. */
  dateTime(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /** ISO → "Mar 5, 2026"; '' si null. */
  dateOnly(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
