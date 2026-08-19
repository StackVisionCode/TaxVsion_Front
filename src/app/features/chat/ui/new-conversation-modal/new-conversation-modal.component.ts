import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { EmployeeDirectoryEntry } from '../../data-access/chat.model';

const SEARCH_DEBOUNCE_MS = 300;

export interface GroupCreateRequest {
  title: string;
  members: EmployeeDirectoryEntry[];
}

/**
 * Modal de "nueva conversación": buscador de compañeros de equipo (directorio de
 * empleados, no de clientes — ver ChatDirectoryService) + selección directa 1:1, y si
 * el usuario tiene el permiso `communication.group.create`, un modo "Group" con
 * multi-selección + título. Presentacional puro sobre `app-modal`.
 */
@Component({
  selector: 'app-new-conversation-modal',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './new-conversation-modal.component.html',
})
export class NewConversationModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() employees: EmployeeDirectoryEntry[] = [];
  @Input() searching = false;
  @Input() error: string | null = null;
  @Input() creationError: string | null = null;
  @Input() canCreateGroups = false;
  @Input() creating = false;

  @Output() closed = new EventEmitter<void>();
  @Output() searchChanged = new EventEmitter<string>();
  @Output() directSelected = new EventEmitter<EmployeeDirectoryEntry>();
  @Output() groupCreateRequested = new EventEmitter<GroupCreateRequest>();

  readonly mode = signal<'direct' | 'group'>('direct');
  readonly searchTerm = signal('');
  readonly groupTitle = signal('');
  readonly selectedMembers = signal<EmployeeDirectoryEntry[]>([]);

  private searchDebounce: ReturnType<typeof setTimeout> | undefined;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.mode.set('direct');
      this.searchTerm.set('');
      this.groupTitle.set('');
      this.selectedMembers.set([]);
    }
  }

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.searchChanged.emit(value), SEARCH_DEBOUNCE_MS);
  }

  isSelected(entry: EmployeeDirectoryEntry): boolean {
    return this.selectedMembers().some(m => m.userId === entry.userId);
  }

  selectEmployee(entry: EmployeeDirectoryEntry): void {
    if (this.mode() === 'direct') {
      this.directSelected.emit(entry);
      return;
    }
    this.selectedMembers.update(list =>
      this.isSelected(entry) ? list.filter(m => m.userId !== entry.userId) : [...list, entry],
    );
  }

  createGroup(): void {
    const title = this.groupTitle().trim();
    const members = this.selectedMembers();
    if (!title || members.length === 0) {
      return;
    }
    this.groupCreateRequested.emit({ title, members });
  }

  initials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  }
}
