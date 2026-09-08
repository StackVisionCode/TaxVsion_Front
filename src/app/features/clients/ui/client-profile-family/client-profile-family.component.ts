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
import { ClientProfile } from '../../models/client-profile.model';
import { AddRelationRequest, RelationResponse, RelationPurpose } from '../../data-access/clients.model';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';

const RELATIONSHIPS = ['Spouse', 'Child', 'Parent', 'Other'];
const PAGE_SIZE = 6;

export interface SaveRelationPayload {
  /** null = alta nueva; con valor = edición de esa relación. */
  id: string | null;
  req: AddRelationRequest;
}

/**
 * Pestaña "Family" del perfil de cliente, cableada contra
 * `/customers/{id}/relations` — las **escrituras** son reales
 * (POST/PATCH/DELETE existen y funcionan).
 *
 * ⚠️ La **lectura** no: verificado contra el backend (2026-08-28) no hay
 * `GET` de relaciones, y `GET /customers/{id}` devuelve `CustomerResponse`,
 * que son solo escalares. Por eso el contenedor conserva en memoria lo
 * guardado en la sesión y pasa `sessionOnly` para que la UI lo diga en vez
 * de aparentar una lista persistida: recargar la página vacía la lista
 * aunque los datos sí quedaron en el servidor.
 *
 * `RelationResponse` NO separa first/last name (solo `displayName`), así que
 * al editar se pre-completa partiendo el nombre por el primer espacio — el
 * usuario puede corregirlo si el split no calzó (ver `fillFormFrom`).
 *
 * Presentacional puro (regla del repo: `ui/*` nunca inyecta el store): el
 * HTTP lo dispara el contenedor (`client-profile-page`) vía los
 * `@Output()`; esta pestaña solo deriva spouse/dependents de
 * `client.relations` para mostrarlos y vuelve a derivarlos cuando el padre
 * refresca `client` tras guardar/borrar.
 */
@Component({
  selector: 'app-client-profile-family',
  imports: [CommonModule, FormsModule, ModalComponent, ConfirmDialogComponent, PaginationComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-family.component.html',
  styleUrl: './client-profile-family.component.css',
})
export class ClientProfileFamilyComponent implements OnChanges {
  @Input() client: ClientProfile | null = null;
  @Input() saving = false;
  @Input() saveError: string | null = null;
  /** true = lo listado solo vive en memoria porque el backend no expone lectura de relaciones. */
  @Input() sessionOnly = false;

  @Output() saveRelation = new EventEmitter<SaveRelationPayload>();
  @Output() deleteRelation = new EventEmitter<string>();

  readonly relationships = RELATIONSHIPS;
  readonly pageSize = PAGE_SIZE;

  readonly dependents = signal<RelationResponse[]>([]);
  readonly spouse = signal<RelationResponse | null>(null);

  readonly search = signal('');
  readonly currentPage = signal(1);

  readonly visibleDependents = computed<RelationResponse[]>(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) {
      return this.dependents();
    }
    return this.dependents().filter(
      dependent =>
        dependent.displayName.toLowerCase().includes(query) || dependent.relationshipKind.toLowerCase().includes(query),
    );
  });

  readonly pagedDependents = computed<RelationResponse[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleDependents().slice(start, start + PAGE_SIZE);
  });

  // ---------- Form (compartido dependent/spouse — ambos son `relations`) ----------
  readonly isFormOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly formMode = signal<'dependent' | 'spouse'>('dependent');
  readonly firstName = signal('');
  readonly lastName = signal('');
  readonly relationshipKind = signal(RELATIONSHIPS[0]);
  readonly dateOfBirth = signal('');
  readonly primaryEmail = signal('');
  readonly primaryPhone = signal('');
  readonly isRelationshipOpen = signal(false);

  readonly pendingDeleteId = signal<string | null>(null);
  readonly pendingDeleteName = signal('');

  readonly canSave = computed(() => this.firstName().trim().length > 0 && this.lastName().trim().length > 0);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['client']) {
      const relations = this.client?.relations ?? [];
      const spouseRelation = relations.find(r => r.relationshipKind === 'Spouse') ?? null;
      this.spouse.set(spouseRelation);
      this.dependents.set(relations.filter(r => r.id !== spouseRelation?.id));
      this.search.set('');
      this.currentPage.set(1);
      // Un guardado exitoso del padre cierra el form y limpia el pending-delete
      // (ver comentario en submitForm/confirmDelete): si seguían abiertos acá
      // es que la mutación recién terminó y el padre refrescó `client`.
      if (!this.saving) {
        this.isFormOpen.set(false);
        this.pendingDeleteId.set(null);
      }
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="dependent-relationship"]')) {
      this.isRelationshipOpen.set(false);
    }
  }

  age(dateOfBirth: string | null | undefined): number | null {
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
    this.formMode.set('dependent');
    this.resetForm(RELATIONSHIPS[1]);
    this.isFormOpen.set(true);
  }

  openEditDependent(relation: RelationResponse): void {
    this.formMode.set('dependent');
    this.fillFormFrom(relation);
    this.isFormOpen.set(true);
  }

  requestDeleteDependent(relation: RelationResponse): void {
    this.pendingDeleteId.set(relation.id);
    this.pendingDeleteName.set(relation.displayName);
  }

  // --- Spouse actions ---

  openAddSpouse(): void {
    this.formMode.set('spouse');
    this.resetForm('Spouse');
    this.isFormOpen.set(true);
  }

  openEditSpouse(): void {
    const spouse = this.spouse();
    if (!spouse) {
      return;
    }
    this.formMode.set('spouse');
    this.fillFormFrom(spouse);
    this.isFormOpen.set(true);
  }

  requestDeleteSpouse(): void {
    const spouse = this.spouse();
    if (!spouse) {
      return;
    }
    this.pendingDeleteId.set(spouse.id);
    this.pendingDeleteName.set(spouse.displayName);
  }

  // --- Form compartido ---

  private resetForm(relationshipKind: string): void {
    this.editingId.set(null);
    this.firstName.set('');
    this.lastName.set('');
    this.relationshipKind.set(relationshipKind);
    this.dateOfBirth.set('');
    this.primaryEmail.set('');
    this.primaryPhone.set('');
  }

  /** `RelationResponse` no separa first/last — se parte `displayName` en el primer espacio como mejor esfuerzo. */
  private fillFormFrom(relation: RelationResponse): void {
    this.editingId.set(relation.id);
    const spaceIndex = relation.displayName.indexOf(' ');
    this.firstName.set(spaceIndex === -1 ? relation.displayName : relation.displayName.slice(0, spaceIndex));
    this.lastName.set(spaceIndex === -1 ? '' : relation.displayName.slice(spaceIndex + 1));
    this.relationshipKind.set(relation.relationshipKind);
    this.dateOfBirth.set(relation.dateOfBirth ?? '');
    this.primaryEmail.set(relation.primaryEmail ?? '');
    this.primaryPhone.set(relation.primaryPhone ?? '');
  }

  closeForm(): void {
    this.isFormOpen.set(false);
  }

  toggleRelationshipDropdown(): void {
    this.isRelationshipOpen.update(open => !open);
  }

  selectRelationship(kind: string): void {
    this.relationshipKind.set(kind);
    this.isRelationshipOpen.set(false);
  }

  submitForm(): void {
    if (!this.canSave()) {
      return;
    }
    const kind = this.relationshipKind();
    const purposes = kind === 'Spouse' ? RelationPurpose.TaxHouseholdMember : RelationPurpose.Dependent;
    const req: AddRelationRequest = {
      relationshipKind: kind,
      purposes,
      firstName: this.firstName().trim(),
      lastName: this.lastName().trim(),
      dateOfBirth: this.dateOfBirth() || null,
      primaryEmail: this.primaryEmail().trim() || null,
      primaryPhone: this.primaryPhone().trim() || null,
    };
    this.saveRelation.emit({ id: this.editingId(), req });
  }

  confirmDelete(): void {
    const id = this.pendingDeleteId();
    if (id) {
      this.deleteRelation.emit(id);
    }
  }

  cancelDelete(): void {
    this.pendingDeleteId.set(null);
  }
}
