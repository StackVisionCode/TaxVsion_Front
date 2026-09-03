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
import { ClientWorkStore } from '../../data-access/client-work.store';
import {
  ApiTaskPriority,
  EmployeeDirectoryEntry,
  WORK_COLUMNS,
  WorkColumnId,
  WorkTaskFormValue,
  WorkTaskItem,
  avatarColorFor,
  initialsFor,
} from '../../data-access/client-work.model';

const PRIORITIES: ApiTaskPriority[] = ['Low', 'Normal', 'High', 'Urgent'];
const ASSIGNEE_SEARCH_DEBOUNCE_MS = 250;

interface AssigneeOption {
  userId: string;
  displayName: string;
}

/**
 * Editor de tareas de la pestaña "Work". A diferencia del panel del módulo Task, el CLIENTE ya
 * está fijado (es este perfil), así que no hay picker de cliente. El componente solo emite un
 * `WorkTaskFormValue`; las llamadas las orquesta `ClientWorkStore`. Template-driven + signals.
 */
@Component({
  selector: 'app-client-work-form',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-work-form.component.html',
})
export class ClientWorkFormComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() task: WorkTaskItem | null = null;
  @Input() clientName = '';
  @Input() busy = false;
  @Input() errorMessage: string | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<WorkTaskFormValue>();

  private readonly store = inject(ClientWorkStore);

  readonly priorities = PRIORITIES;
  readonly statuses = WORK_COLUMNS;

  readonly title = signal('');
  readonly description = signal('');
  readonly dueDate = signal('');
  readonly priority = signal<ApiTaskPriority>('Normal');
  readonly status = signal<WorkColumnId>('not-started');
  readonly expectedItems = signal('');
  readonly assignee = signal<AssigneeOption | null>(null);
  readonly assigneeSearch = signal('');
  readonly assigneeResults = signal<EmployeeDirectoryEntry[]>([]);

  readonly isPriorityOpen = signal(false);
  readonly isStatusOpen = signal(false);
  readonly isAssigneeOpen = signal(false);

  private assigneeDebounce: ReturnType<typeof setTimeout> | null = null;

  /** Signal propia porque `task` es un @Input plano: un computed() no reaccionaría a sus cambios. */
  readonly isEditMode = signal(false);

  readonly canSave = computed(() => {
    if (this.title().trim().length === 0) {
      return false;
    }
    // El backend exige expectedItems para pasar a "Waiting on client".
    if (this.status() === 'waiting') {
      return this.expectedItems().trim().length > 0;
    }
    return true;
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
    if (!target.closest('[data-dropdown="work-priority"]')) {
      this.isPriorityOpen.set(false);
    }
    if (!target.closest('[data-dropdown="work-status"]')) {
      this.isStatusOpen.set(false);
    }
    if (!target.closest('[data-dropdown="work-assignee"]')) {
      this.isAssigneeOpen.set(false);
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

  selectPriority(priority: ApiTaskPriority): void {
    this.priority.set(priority);
    this.isPriorityOpen.set(false);
  }

  selectStatus(status: WorkColumnId): void {
    this.status.set(status);
    this.isStatusOpen.set(false);
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

  statusLabel(status: WorkColumnId): string {
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
      dueDate: this.dueDate(),
      priority: this.priority(),
      status: this.status(),
      assignee: this.assignee(),
      expectedItems: this.expectedItems(),
    });
  }

  private closeAllDropdowns(): void {
    this.isPriorityOpen.set(false);
    this.isStatusOpen.set(false);
    this.isAssigneeOpen.set(false);
  }

  private resetForm(): void {
    const task = this.task;
    if (task) {
      this.title.set(task.title);
      this.description.set(task.description);
      this.dueDate.set(task.dueDate);
      this.priority.set(task.priority);
      this.status.set(task.column ?? 'not-started');
      this.expectedItems.set(task.expectedItems);
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
      this.assignee.set(null);
    }
    this.assigneeSearch.set('');
    this.assigneeResults.set([]);
    this.closeAllDropdowns();
  }
}
