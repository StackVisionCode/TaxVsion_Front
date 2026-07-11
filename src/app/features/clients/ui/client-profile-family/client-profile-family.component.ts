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
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClientDependent, ClientProfile, ClientSpouse } from '../../models/client-profile.model';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';

const RELATIONSHIPS = ['Daughter', 'Son', 'Spouse', 'Parent', 'Other'];
const PAGE_SIZE = 6;

/**
 * Pestaña "Family" del perfil de cliente (dependents + spouse): puerto
 * visual/estructural de las páginas legacy `cuenta-dependents`/
 * `cuenta-spouses` combinadas en una sola pestaña (spouse es 0-o-1 por
 * cliente, dependents es una lista). Ambos mini-formularios viven inline en
 * este componente (dos `app-modal`), replicando el patrón de dos-modos de
 * `client-form-panel`. Estado 100% local: se reinicializa en ngOnChanges
 * cada vez que cambia el `client` recibido (sin persistencia real).
 */
@Component({
  selector: 'app-client-profile-family',
  imports: [CommonModule, FormsModule, ModalComponent, ConfirmDialogComponent, PaginationComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-family.component.html',
})
export class ClientProfileFamilyComponent implements OnChanges {
  @Input() client: ClientProfile | null = null;

  readonly relationships = RELATIONSHIPS;
  readonly pageSize = PAGE_SIZE;

  readonly dependents = signal<ClientDependent[]>([]);
  readonly spouse = signal<ClientSpouse | null>(null);

  readonly search = signal('');
  readonly currentPage = signal(1);

  readonly visibleDependents = computed<ClientDependent[]>(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) {
      return this.dependents();
    }
    return this.dependents().filter(
      dependent => dependent.name.toLowerCase().includes(query) || dependent.relationship.toLowerCase().includes(query),
    );
  });

  readonly pagedDependents = computed<ClientDependent[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleDependents().slice(start, start + PAGE_SIZE);
  });

  // Dependent form
  readonly isDependentModalOpen = signal(false);
  readonly editingDependentIndex = signal<number | null>(null);
  readonly depName = signal('');
  readonly depRelationship = signal(RELATIONSHIPS[0]);
  readonly depDateOfBirth = signal('');
  readonly depSsnOrItin = signal('');
  readonly isRelationshipOpen = signal(false);
  readonly pendingDeleteDependentIndex = signal<number | null>(null);

  readonly canSaveDependent = computed(() => this.depName().trim().length > 0);

  // Spouse form
  readonly isSpouseModalOpen = signal(false);
  readonly spName = signal('');
  readonly spSsnOrItin = signal('');
  readonly spDateOfBirth = signal('');
  readonly spPhone = signal('');
  readonly spEmail = signal('');
  readonly pendingDeleteSpouse = signal(false);

  readonly canSaveSpouse = computed(() => this.spName().trim().length > 0);

  readonly pendingDeleteDependentMessage = computed(() => {
    const index = this.pendingDeleteDependentIndex();
    if (index === null) {
      return '';
    }
    const dependent = this.dependents()[index];
    return dependent ? `You're about to remove ${dependent.name} as a dependent. This can't be undone.` : '';
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['client']) {
      this.dependents.set([...(this.client?.dependents ?? [])]);
      this.spouse.set(this.client?.spouse ?? null);
      this.search.set('');
      this.currentPage.set(1);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="dependent-relationship"]')) {
      this.isRelationshipOpen.set(false);
    }
  }

  age(dateOfBirth: string): number | null {
    if (!dateOfBirth) {
      return null;
    }
    const birth = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

  maskSsn(ssnOrItin?: string): string {
    if (!ssnOrItin) {
      return '—';
    }
    const last4 = ssnOrItin.slice(-4);
    return `•••-••-${last4}`;
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

  // --- Dependent actions ---

  openAddDependent(): void {
    this.editingDependentIndex.set(null);
    this.depName.set('');
    this.depRelationship.set(RELATIONSHIPS[0]);
    this.depDateOfBirth.set('');
    this.depSsnOrItin.set('');
    this.isDependentModalOpen.set(true);
  }

  openEditDependent(index: number): void {
    const dependent = this.dependents()[index];
    if (!dependent) {
      return;
    }
    this.editingDependentIndex.set(index);
    this.depName.set(dependent.name);
    this.depRelationship.set(dependent.relationship);
    this.depDateOfBirth.set(dependent.dateOfBirth);
    this.depSsnOrItin.set(dependent.ssnOrItin ?? '');
    this.isDependentModalOpen.set(true);
  }

  closeDependentModal(): void {
    this.isDependentModalOpen.set(false);
    this.editingDependentIndex.set(null);
  }

  toggleRelationshipDropdown(): void {
    this.isRelationshipOpen.update(open => !open);
  }

  selectRelationship(relationship: string): void {
    this.depRelationship.set(relationship);
    this.isRelationshipOpen.set(false);
  }

  saveDependent(): void {
    if (!this.canSaveDependent()) {
      return;
    }
    const dependent: ClientDependent = {
      name: this.depName().trim(),
      relationship: this.depRelationship(),
      dateOfBirth: this.depDateOfBirth(),
      ssnOrItin: this.depSsnOrItin().trim() || undefined,
    };
    const index = this.editingDependentIndex();
    this.dependents.update(list => {
      if (index === null) {
        return [...list, dependent];
      }
      return list.map((item, i) => (i === index ? dependent : item));
    });
    this.closeDependentModal();
  }

  requestDeleteDependent(index: number): void {
    this.pendingDeleteDependentIndex.set(index);
  }

  confirmDeleteDependent(): void {
    const index = this.pendingDeleteDependentIndex();
    if (index === null) {
      return;
    }
    this.dependents.update(list => list.filter((_, i) => i !== index));
    this.pendingDeleteDependentIndex.set(null);
  }

  // --- Spouse actions ---

  openAddSpouse(): void {
    this.spName.set('');
    this.spSsnOrItin.set('');
    this.spDateOfBirth.set('');
    this.spPhone.set('');
    this.spEmail.set('');
    this.isSpouseModalOpen.set(true);
  }

  openEditSpouse(): void {
    const spouse = this.spouse();
    if (!spouse) {
      return;
    }
    this.spName.set(spouse.name);
    this.spSsnOrItin.set(spouse.ssnOrItin);
    this.spDateOfBirth.set(spouse.dateOfBirth);
    this.spPhone.set(spouse.phone ?? '');
    this.spEmail.set(spouse.email ?? '');
    this.isSpouseModalOpen.set(true);
  }

  closeSpouseModal(): void {
    this.isSpouseModalOpen.set(false);
  }

  saveSpouse(): void {
    if (!this.canSaveSpouse()) {
      return;
    }
    const existing = this.spouse();
    const spouse: ClientSpouse = {
      name: this.spName().trim(),
      ssnOrItin: this.spSsnOrItin().trim(),
      dateOfBirth: this.spDateOfBirth(),
      phone: this.spPhone().trim() || undefined,
      email: this.spEmail().trim() || undefined,
      createdAt: existing?.createdAt ?? new Date().toISOString().slice(0, 10),
    };
    this.spouse.set(spouse);
    this.closeSpouseModal();
  }

  requestDeleteSpouse(): void {
    this.pendingDeleteSpouse.set(true);
  }

  confirmDeleteSpouse(): void {
    this.spouse.set(null);
    this.pendingDeleteSpouse.set(false);
  }
}
