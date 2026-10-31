import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { AvatarUrlPipe } from '@core/profile-photo/avatar-url.pipe';
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
  description?: string;
  memberUserIds: string[];
}

/** F8b: alguien elegido para el grupo (equipo o cliente con portal). */
export interface GroupPick {
  userId: string;
  displayName: string;
  avatarFileId?: string | null;
  isClient: boolean;
}

const DESCRIPTION_MAX = 500;

/**
 * Modal de "nueva conversación". Dos audiencias:
 *  - Clients: busca en el directorio de clientes; 1:1 con `portalUserId`. Los clientes sin
 *    portal (`portalUserId == null`) se muestran deshabilitados ("Portal not activated").
 *  - Team: compañeros de equipo.
 * Con `communication.group.create`, el modo Group junta gente de las dos audiencias (ADD-02 H-1); con más
 * de un cliente avisa que se verán entre sí (D-20; el backend decide si la oficina lo permite).
 * Presentacional puro sobre `app-modal`: el padre resuelve búsquedas y creación.
 */
@Component({
  selector: 'app-new-conversation-modal',
  imports: [CommonModule, FormsModule, ModalComponent, AvatarComponent, AvatarUrlPipe, SearchInputComponent, SegmentedComponent],
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
  readonly groupDescription = signal('');
  readonly descriptionMax = DESCRIPTION_MAX;
  readonly selectedMembers = signal<GroupPick[]>([]);
  /** D-20: con más de un cliente se ven entre sí. */
  readonly selectedClients = computed(() => this.selectedMembers().filter(m => m.isClient).length);

  private searchDebounce: ReturnType<typeof setTimeout> | undefined;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.audience.set('clients');
      this.mode.set('direct');
      this.searchTerm.set('');
      this.groupTitle.set('');
      this.groupDescription.set('');
      this.selectedMembers.set([]);
    }
  }

  setAudience(audience: ConversationAudience): void {
    if (this.audience() === audience) {
      return;
    }
    this.audience.set(audience);
    // F8b: en modo grupo la selección se conserva al cambiar de audiencia (equipo + clientes).
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

  isSelected(userId: string | null): boolean {
    return !!userId && this.selectedMembers().some(m => m.userId === userId);
  }

  selectEmployee(entry: EmployeeDirectoryEntry): void {
    if (entry.chatBlockedReason) {
      return;
    }
    if (this.mode() === 'direct') {
      this.directSelected.emit(entry);
      return;
    }
    this.togglePick({ userId: entry.userId, displayName: entry.displayName, avatarFileId: entry.avatarFileId, isClient: false });
  }

  removePick(userId: string): void {
    this.selectedMembers.update(list => list.filter(m => m.userId !== userId));
  }

  private togglePick(pick: GroupPick): void {
    this.selectedMembers.update(list =>
      this.isSelected(pick.userId) ? list.filter(m => m.userId !== pick.userId) : [...list, pick],
    );
  }

  /** Cliente chateable = tiene cuenta de portal activa. */
  isChatable(entry: CustomerDirectoryEntry): boolean {
    return !!entry.portalUserId && !entry.chatBlockedReason;
  }

  selectCustomer(entry: CustomerDirectoryEntry): void {
    if (!this.isChatable(entry) || !entry.portalUserId) {
      return;
    }
    if (this.mode() === 'group') {
      this.togglePick({ userId: entry.portalUserId, displayName: entry.displayName, avatarFileId: entry.avatarFileId, isClient: true });
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
    const description = this.groupDescription().trim();
    this.groupCreateRequested.emit({
      title,
      memberUserIds: members.map(m => m.userId),
      ...(description ? { description } : {}),
    });
  }

}
