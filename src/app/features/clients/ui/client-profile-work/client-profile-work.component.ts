import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  HostListener,
  Input,
  OnChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { PermissionService } from '@core/auth/permission.service';
import { ToastService } from '../../../../shared/ui/toast/toast.service';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { ClientWorkFormComponent } from '../client-work-form/client-work-form.component';
import { ClientWorkStore } from '../../data-access/client-work.store';
import {
  ApiTaskPriority,
  WORK_COLUMNS,
  WorkColumnId,
  WorkTaskFormValue,
  WorkTaskItem,
} from '../../data-access/client-work.model';

/** Permisos del servicio Tasks (BuildingBlocks.Authorization.TasksPermissions). */
const TASKS_READ = 'tasks.read';
const TASKS_WRITE = 'tasks.write';

/**
 * Pestaña "Work" del perfil de cliente, cableada contra Tasks.Api (`/tasks/by-customer/{id}`).
 *
 * El vínculo con el cliente es REAL (cada tarea lleva `customerId`), así que la lista es de ESTE
 * cliente, no un mock. Se agrupa por estado en secciones (Not started / In progress / Waiting on
 * client / Completed), con transiciones inline por su verbo dedicado (no hay "set status"
 * genérico) y un editor con el cliente ya fijado. "Waiting on client" es el mecanismo real
 * `wait-on-client` (con `expectedItems`), que es lo más cercano en el contrato a "lo pedido al
 * cliente".
 */
@Component({
  selector: 'app-client-profile-work',
  imports: [CommonModule, FormsModule, ModalComponent, ConfirmDialogComponent, ClientWorkFormComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-work.component.html',
  styleUrl: './client-profile-work.component.css',
})
export class ClientProfileWorkComponent implements OnChanges {
  @Input() clientId = '';
  @Input() clientName = '';

  readonly store = inject(ClientWorkStore);
  private readonly perms = inject(PermissionService);
  private readonly toast = inject(ToastService);

  readonly columns = WORK_COLUMNS;

  readonly canRead = computed(() => this.perms.has(TASKS_READ));
  readonly canWrite = computed(() => this.perms.has(TASKS_WRITE));

  /** Menú de acciones abierto (uno por fila). */
  readonly openMenuId = signal<string | null>(null);
  /** Sección de Cancelled plegada por defecto (ruido histórico). */
  readonly showCancelled = signal(false);

  // ---------- Editor (crear / editar) ----------
  readonly isFormOpen = signal(false);
  readonly editingTask = signal<WorkTaskItem | null>(null);
  readonly savingForm = signal(false);
  readonly formError = signal<string | null>(null);

  // ---------- Diálogo "Request from client" (wait-on-client) ----------
  readonly waitTask = signal<WorkTaskItem | null>(null);
  readonly waitItems = signal('');
  readonly waitDue = signal('');
  readonly waitSaving = signal(false);
  readonly waitError = signal<string | null>(null);

  // ---------- Diálogo Cancel (razón obligatoria) ----------
  readonly cancelTaskItem = signal<WorkTaskItem | null>(null);
  readonly cancelReason = signal('');
  readonly cancelSaving = signal(false);
  readonly cancelError = signal<string | null>(null);

  // ---------- Confirmación de borrado ----------
  readonly pendingDelete = signal<WorkTaskItem | null>(null);
  readonly pendingDeleteMessage = computed(() => {
    const task = this.pendingDelete();
    return task ? `"${task.title}" will be permanently deleted. This cannot be undone.` : '';
  });

  ngOnChanges(): void {
    if (this.clientId) {
      this.store.load(this.clientId);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="work-row-menu"]')) {
      this.openMenuId.set(null);
    }
  }

  retry(): void {
    this.store.refresh();
  }

  dismissActionError(): void {
    this.store.clearActionError();
  }

  toggleCancelledSection(): void {
    this.showCancelled.update(open => !open);
  }

  // ---------- Menú de fila ----------

  toggleMenu(task: WorkTaskItem, event: Event): void {
    event.stopPropagation();
    this.openMenuId.update(current => (current === task.id ? null : task.id));
  }

  /** Transición directa (start/complete/reopen). Waiting va por el diálogo dedicado. */
  moveTo(task: WorkTaskItem, target: WorkColumnId): void {
    this.openMenuId.set(null);
    this.store.moveTo(task, target);
  }

  // ---------- Editor ----------

  openCreate(): void {
    this.editingTask.set(null);
    this.formError.set(null);
    this.isFormOpen.set(true);
  }

  openEdit(task: WorkTaskItem): void {
    this.openMenuId.set(null);
    this.editingTask.set(task);
    this.formError.set(null);
    this.isFormOpen.set(true);
  }

  closeForm(): void {
    this.isFormOpen.set(false);
    this.editingTask.set(null);
    this.formError.set(null);
  }

  handleSave(form: WorkTaskFormValue): void {
    const editing = this.editingTask();
    this.savingForm.set(true);
    this.formError.set(null);
    const request = editing ? this.store.updateTask(editing, form) : this.store.createTask(form);
    request.subscribe({
      next: () => {
        this.savingForm.set(false);
        this.isFormOpen.set(false);
        this.editingTask.set(null);
        this.toast.success(editing ? 'Task updated' : 'Task created');
      },
      error: err => {
        this.formError.set(toApiError(err).message);
        this.savingForm.set(false);
      },
    });
  }

  // ---------- Request from client (wait-on-client) ----------

  openWait(task: WorkTaskItem): void {
    this.openMenuId.set(null);
    this.waitTask.set(task);
    this.waitItems.set(task.expectedItems);
    this.waitDue.set(task.clientDueAtUtc ? task.clientDueAtUtc.slice(0, 10) : '');
    this.waitError.set(null);
  }

  closeWait(): void {
    this.waitTask.set(null);
    this.waitError.set(null);
  }

  confirmWait(): void {
    const task = this.waitTask();
    const items = this.waitItems().trim();
    if (!task || !items || this.waitSaving()) {
      return;
    }
    this.waitSaving.set(true);
    this.waitError.set(null);
    const due = this.waitDue() ? `${this.waitDue()}T00:00:00Z` : null;
    this.store.waitOnClient(task, items, due).subscribe({
      next: () => {
        this.waitSaving.set(false);
        this.waitTask.set(null);
        this.toast.success('Marked as waiting on client');
      },
      error: err => {
        this.waitError.set(toApiError(err).message);
        this.waitSaving.set(false);
      },
    });
  }

  // ---------- Cancel ----------

  openCancel(task: WorkTaskItem): void {
    this.openMenuId.set(null);
    this.cancelTaskItem.set(task);
    this.cancelReason.set('');
    this.cancelError.set(null);
  }

  closeCancel(): void {
    this.cancelTaskItem.set(null);
    this.cancelError.set(null);
  }

  confirmCancel(): void {
    const task = this.cancelTaskItem();
    const reason = this.cancelReason().trim();
    if (!task || !reason || this.cancelSaving()) {
      return;
    }
    this.cancelSaving.set(true);
    this.cancelError.set(null);
    this.store.cancelTask(task, reason).subscribe({
      next: () => {
        this.cancelSaving.set(false);
        this.cancelTaskItem.set(null);
        this.toast.success('Task cancelled');
      },
      error: err => {
        this.cancelError.set(toApiError(err).message);
        this.cancelSaving.set(false);
      },
    });
  }

  // ---------- Delete ----------

  requestDelete(task: WorkTaskItem): void {
    this.openMenuId.set(null);
    this.pendingDelete.set(task);
  }

  confirmDelete(): void {
    const task = this.pendingDelete();
    if (task) {
      this.store.remove(task.id);
      this.toast.success('Task deleted');
    }
    this.pendingDelete.set(null);
  }

  // ---------- Helpers de presentación ----------

  tasksInColumn(column: WorkColumnId): WorkTaskItem[] {
    return this.store.tasksInColumn(column);
  }

  cancelledTasks(): WorkTaskItem[] {
    return this.store.cancelledTasks();
  }

  priorityChipClass(priority: ApiTaskPriority): string {
    switch (priority) {
      case 'Urgent':
        return 'border-red-200 text-red-500';
      case 'High':
        return 'border-orange-200 text-orange-500';
      case 'Normal':
        return 'border-amber-200 text-amber-600';
      case 'Low':
        return 'border-emerald-200 text-emerald-600';
    }
  }

  formatDue(dueDate: string): string {
    if (!dueDate) {
      return 'No due date';
    }
    const due = new Date(`${dueDate}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Due today';
    if (diffDays === 1) return 'Due tomorrow';
    if (diffDays === -1) return 'Due yesterday';
    if (diffDays < -1) return `${Math.abs(diffDays)} days overdue`;
    return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  trackByTaskId(_index: number, task: WorkTaskItem): string {
    return task.id;
  }
}
