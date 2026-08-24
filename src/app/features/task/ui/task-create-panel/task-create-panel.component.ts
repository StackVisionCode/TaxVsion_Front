import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { TaskStore } from '../../data-access/task.store';
import {
  ApiTaskPriority,
  EmployeeDirectoryEntry,
  TASK_COLUMNS,
  TaskClientSummary,
  TaskFormValue,
  TaskItem,
  TaskStatus,
  avatarColorFor,
  initialsFor,
} from '../../data-access/task.model';

const PRIORITIES: ApiTaskPriority[] = ['Low', 'Normal', 'High', 'Urgent'];
const ASSIGNEE_SEARCH_DEBOUNCE_MS = 250;

interface AssigneeOption {
  userId: string;
  displayName: string;
}

/**
 * Overlay de creación/edición del módulo Task contra la API real. Mismo patrón visual
 * que antes (tarjeta centrada, píldoras con dropdown propio), pero:
 *  - Cliente: picker sobre GET /customers (el backend pide `customerId`, no texto libre).
 *  - Asignado: type-ahead sobre GET /communication/directory/employees.
 *  - Estado "Waiting on Client": exige el detalle de lo pedido (`expectedItems`) y un cliente.
 *  - En edición aparecen además "Cancel task…" (razón obligatoria) y "Delete".
 * El componente solo emite un TaskFormValue: las llamadas las orquesta TaskStore.
 */
@Component({
  selector: 'app-task-create-panel',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './task-create-panel.component.html',
})
export class TaskCreatePanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() task: TaskItem | null = null;
  /** Guardado en curso: deshabilita las acciones para no duplicar llamadas. */
  @Input() busy = false;
  /** Error del último intento de guardar/borrar/cancelar; se muestra dentro del panel. */
  @Input() errorMessage: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<TaskFormValue>();
  @Output() deleted = new EventEmitter<TaskItem>();
  @Output() taskCancelled = new EventEmitter<{ task: TaskItem; reason: string }>();

  private readonly store = inject(TaskStore);

  readonly priorities = PRIORITIES;
  readonly statuses = TASK_COLUMNS;

  readonly title = signal('');
  readonly description = signal('');
  readonly dueDate = signal('');
  readonly priority = signal<ApiTaskPriority>('Normal');
  readonly status = signal<TaskStatus>('not-started');
  readonly expectedItems = signal('');
  readonly selectedClient = signal<TaskClientSummary | null>(null);
  readonly clientSearch = signal('');
  readonly assignee = signal<AssigneeOption | null>(null);
  readonly assigneeSearch = signal('');
  readonly assigneeResults = signal<EmployeeDirectoryEntry[]>([]);

  readonly isPriorityOpen = signal(false);
  readonly isStatusOpen = signal(false);
  readonly isAssigneeOpen = signal(false);
  readonly isClientOpen = signal(false);
  readonly isCancelOpen = signal(false);
  readonly cancelReason = signal('');
  readonly isDeleteArmed = signal(false);

  private assigneeDebounce: ReturnType<typeof setTimeout> | null = null;

  /** Signal propia porque `task` es un @Input plano: un computed() no reaccionaría a sus cambios. */
  readonly isEditMode = signal(false);

  readonly filteredClients = computed<TaskClientSummary[]>(() => {
    const query = this.clientSearch().trim().toLowerCase();
    const all = this.store.clients();
    return query ? all.filter(client => client.displayName.toLowerCase().includes(query)) : all;
  });

  readonly canSave = computed(() => {
    if (this.title().trim().length === 0) {
      return false;
    }
    if (this.status() === 'waiting') {
      // El backend exige customerId + expectedItems para wait-on-client.
      return this.selectedClient() !== null && this.expectedItems().trim().length > 0;
    }
    return true;
  });

  /** Cancelar solo aplica a tareas abiertas: el backend rechaza cancelar una Completed. */
  readonly canCancelTask = computed(() => {
    const task = this.task;
    return this.isEditMode() && task !== null && task.apiStatus !== 'Completed' && task.apiStatus !== 'Cancelled';
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['task'] || changes['isOpen']) {
      this.isEditMode.set(this.task !== null);
      this.resetForm();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="task-priority"]')) {
      this.isPriorityOpen.set(false);
    }
    if (!target.closest('[data-dropdown="task-status"]')) {
      this.isStatusOpen.set(false);
    }
    if (!target.closest('[data-dropdown="task-assignee"]')) {
      this.isAssigneeOpen.set(false);
    }
    if (!target.closest('[data-dropdown="task-client"]')) {
      this.isClientOpen.set(false);
    }
  }

  togglePriorityDropdown(): void {
    const next = !this.isPriorityOpen();
    this.closeAllDropdowns();
    this.isPriorityOpen.set(next);
  }

  toggleStatusDropdown(): void {
    const next = !this.isStatusOpen();
    this.closeAllDropdowns();
    this.isStatusOpen.set(next);
  }

  toggleAssigneeDropdown(): void {
    const next = !this.isAssigneeOpen();
    this.closeAllDropdowns();
    this.isAssigneeOpen.set(next);
  }

  toggleClientDropdown(): void {
    const next = !this.isClientOpen();
    this.closeAllDropdowns();
    this.isClientOpen.set(next);
  }

  selectPriority(priority: ApiTaskPriority): void {
    this.priority.set(priority);
    this.isPriorityOpen.set(false);
  }

  selectStatus(status: TaskStatus): void {
    this.status.set(status);
    this.isStatusOpen.set(false);
  }

  selectClient(client: TaskClientSummary | null): void {
    this.selectedClient.set(client);
    this.isClientOpen.set(false);
    this.clientSearch.set('');
  }

  selectAssignee(option: AssigneeOption | null): void {
    this.assignee.set(option);
    this.isAssigneeOpen.set(false);
    this.assigneeSearch.set('');
    this.assigneeResults.set([]);
  }

  /** Type-ahead del directorio: q obligatorio en el backend (min 1 char). */
  onAssigneeSearch(term: string): void {
    this.assigneeSearch.set(term);
    if (this.assigneeDebounce !== null) {
      clearTimeout(this.assigneeDebounce);
    }
    const query = term.trim();
    if (!query) {
      this.assigneeResults.set([]);
      return;
    }
    this.assigneeDebounce = setTimeout(() => {
      this.assigneeDebounce = null;
      this.store.searchEmployees(query).subscribe({
        next: results => this.assigneeResults.set(results),
        error: () => this.assigneeResults.set([]),
      });
    }, ASSIGNEE_SEARCH_DEBOUNCE_MS);
  }

  statusLabel(status: TaskStatus): string {
    return this.statuses.find(column => column.id === status)?.label ?? status;
  }

  assigneeInitials(): string {
    const current = this.assignee();
    return current ? initialsFor(current.displayName) : '—';
  }

  assigneeColor(): string {
    const current = this.assignee();
    return current ? avatarColorFor(current.userId) : 'bg-gray-300';
  }

  initialsOf(name: string): string {
    return initialsFor(name);
  }

  colorOf(userId: string): string {
    return avatarColorFor(userId);
  }

  close(): void {
    this.closed.emit();
  }

  save(): void {
    if (!this.canSave() || this.busy) {
      return;
    }
    this.saved.emit({
      title: this.title().trim(),
      description: this.description().trim(),
      customerId: this.selectedClient()?.id ?? null,
      dueDate: this.dueDate(),
      priority: this.priority(),
      status: this.status(),
      assignee: this.assignee(),
      expectedItems: this.expectedItems(),
    });
  }

  /** Dos clicks: el primero arma la confirmación, el segundo borra de verdad. */
  requestDelete(): void {
    if (this.busy || !this.task) {
      return;
    }
    if (!this.isDeleteArmed()) {
      this.isDeleteArmed.set(true);
      return;
    }
    this.deleted.emit(this.task);
  }

  toggleCancelTask(): void {
    this.isCancelOpen.set(!this.isCancelOpen());
    this.cancelReason.set('');
  }

  confirmCancelTask(): void {
    const task = this.task;
    const reason = this.cancelReason().trim();
    if (!task || !reason || this.busy) {
      return;
    }
    this.taskCancelled.emit({ task, reason });
  }

  private closeAllDropdowns(): void {
    this.isPriorityOpen.set(false);
    this.isStatusOpen.set(false);
    this.isAssigneeOpen.set(false);
    this.isClientOpen.set(false);
  }

  private resetForm(): void {
    const task = this.task;
    if (task) {
      this.title.set(task.title);
      this.description.set(task.description);
      this.dueDate.set(task.dueDate);
      this.priority.set(task.priority);
      this.status.set(task.status);
      this.expectedItems.set(task.expectedItems);
      this.selectedClient.set(
        task.customerId
          ? (this.store.clients().find(client => client.id === task.customerId) ?? {
              id: task.customerId,
              displayName: task.client || 'Client',
              primaryEmail: '',
              status: 'Active',
            })
          : null,
      );
      this.assignee.set(
        task.assigneeUserId ? { userId: task.assigneeUserId, displayName: task.assigneeName } : null,
      );
    } else {
      this.title.set('');
      this.description.set('');
      this.dueDate.set('');
      this.priority.set('Normal');
      this.status.set('not-started');
      this.expectedItems.set('');
      this.selectedClient.set(null);
      this.assignee.set(null);
    }
    this.clientSearch.set('');
    this.assigneeSearch.set('');
    this.assigneeResults.set([]);
    this.isCancelOpen.set(false);
    this.cancelReason.set('');
    this.isDeleteArmed.set(false);
    this.closeAllDropdowns();
  }
}
