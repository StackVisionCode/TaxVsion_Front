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
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { SegmentedComponent, SegmentedOption } from '@shared/ui/segmented/segmented.component';
import { CustomerDirectoryEntry, EmployeeDirectoryEntry } from '../../data-access/chat.model';

const SEARCH_DEBOUNCE_MS = 300;

export type ConversationAudience = 'clients' | 'team';

export interface DirectorySearch {
  term: string;
  audience: ConversationAudience;
}

export interface GroupCreateRequest {
  title: string;
  members: EmployeeDirectoryEntry[];
}

/**
 * Modal de "nueva conversación". Dos audiencias:
 *  - Clients: busca en el directorio de clientes; 1:1 con `portalUserId`. Los clientes sin
 *    portal (`portalUserId == null`) se muestran deshabilitados ("Portal not activated").
 *  - Team: compañeros de equipo; 1:1 y, con permiso `communication.group.create`, grupos.
 * Presentacional puro sobre `app-modal`: el padre resuelve búsquedas y creación.
 */
@Component({
  selector: 'app-new-conversation-modal',
  imports: [CommonModule, FormsModule, ModalComponent, AvatarComponent, SearchInputComponent, SegmentedComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './new-conversation-modal.component.html',
})
export class NewConversationModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() employees: EmployeeDirectoryEntry[] = [];
  @Input() customers: CustomerDirectoryEntry[] = [];
  @Input() searching = false;
  @Input() error: string | null = null;
  @Input() creationError: string | null = null;
  @Input() canCreateGroups = false;
  @Input() creating = false;

  @Output() closed = new EventEmitter<void>();
  @Output() searchChanged = new EventEmitter<DirectorySearch>();
  @Output() customerSelected = new EventEmitter<CustomerDirectoryEntry>();
  @Output() directSelected = new EventEmitter<EmployeeDirectoryEntry>();
  @Output() groupCreateRequested = new EventEmitter<GroupCreateRequest>();

  /** Clientes por defecto: es el flujo pedido (staff -> cliente). */
  readonly audience = signal<ConversationAudience>('clients');
  readonly audienceOptions: SegmentedOption<ConversationAudience>[] = [
    { id: 'clients', label: 'Clients' },
    { id: 'team', label: 'Team' },
  ];
  readonly modeOptions: SegmentedOption<'direct' | 'group'>[] = [
    { id: 'direct', label: 'Direct' },
    { id: 'group', label: 'Group' },
  ];
  readonly mode = signal<'direct' | 'group'>('direct');
  readonly searchTerm = signal('');
  readonly groupTitle = signal('');
  readonly selectedMembers = signal<EmployeeDirectoryEntry[]>([]);

  private searchDebounce: ReturnType<typeof setTimeout> | undefined;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.audience.set('clients');
      this.mode.set('direct');
      this.searchTerm.set('');
      this.groupTitle.set('');
      this.selectedMembers.set([]);
    }
  }

  setAudience(audience: ConversationAudience): void {
    if (this.audience() === audience) {
      return;
    }
    this.audience.set(audience);
    this.mode.set('direct'); // los grupos son solo de equipo; se elige aparte
    this.selectedMembers.set([]);
    // Cambiar de audiencia limpia la búsqueda: los resultados de la otra no aplican.
    clearTimeout(this.searchDebounce);
    this.searchTerm.set('');
    this.searchChanged.emit({ term: '', audience });
  }

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
    clearTimeout(this.searchDebounce);
    const audience = this.audience();
    this.searchDebounce = setTimeout(() => this.searchChanged.emit({ term: value, audience }), SEARCH_DEBOUNCE_MS);
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

  /** Cliente chateable = tiene cuenta de portal activa. */
  isChatable(entry: CustomerDirectoryEntry): boolean {
    return !!entry.portalUserId;
  }

  selectCustomer(entry: CustomerDirectoryEntry): void {
    if (!this.isChatable(entry)) {
      return;
    }
    this.customerSelected.emit(entry);
  }

  createGroup(): void {
    const title = this.groupTitle().trim();
    const members = this.selectedMembers();
    if (!title || members.length === 0) {
      return;
    }
    this.groupCreateRequested.emit({ title, members });
  }

}
