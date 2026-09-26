import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { SignatureCategoryOption, signatureCategoryLabel } from '../../data-access/signature.model';
import { SignatureStore } from '../../data-access/signature.store';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';

/**
 * Gestión de categorías del tenant (14.5 F4): renombrar y archivar/desarchivar las custom. Las de
 * sistema son de solo lectura. Archivar solo las oculta del picker — cada solicitud guarda el nombre
 * congelado, así que ni renombrar ni archivar reescriben el histórico ni las métricas.
 */
@Component({
  selector: 'app-signature-category-manager',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-category-manager.component.html',
})
export class SignatureCategoryManagerComponent {
  private _isOpen = false;
  @Input() set isOpen(value: boolean) {
    this._isOpen = value;
    if (value) {
      // Recarga forzada al abrir para reflejar archivadas/renombradas hechas en otra pestaña.
      this.reset();
      this.store.loadCategories(true);
    }
  }
  get isOpen(): boolean {
    return this._isOpen;
  }

  @Output() closed = new EventEmitter<void>();

  readonly store = inject(SignatureStore);
  readonly label = signatureCategoryLabel;

  /** Solo las custom se gestionan; activas primero, luego archivadas, ambas alfabéticas. */
  readonly customCategories = computed(() =>
    this.store
      .categories()
      .filter(category => !category.isSystem)
      .slice()
      .sort((a, b) => Number(a.isArchived) - Number(b.isArchived) || a.name.localeCompare(b.name)),
  );
  readonly systemCategories = computed(() => this.store.categories().filter(category => category.isSystem));

  /** id de la categoría en edición inline (null = ninguna). */
  readonly editingId = signal<string | null>(null);
  readonly editName = signal('');
  /** id de la categoría con una acción en curso (deshabilita sus botones). */
  readonly busyId = signal<string | null>(null);
  readonly error = signal('');

  startRename(category: SignatureCategoryOption): void {
    this.error.set('');
    this.editName.set(category.name);
    this.editingId.set(category.id);
  }

  cancelRename(): void {
    this.editingId.set(null);
  }

  confirmRename(category: SignatureCategoryOption): void {
    const name = this.editName().trim();
    if (!category.id || this.busyId()) {
      return;
    }
    if (name.length < 2) {
      this.error.set('Enter a category name (2+ characters).');
      return;
    }
    this.busyId.set(category.id);
    this.error.set('');
    this.store.renameCategory(category.id, name).subscribe({
      next: () => {
        this.busyId.set(null);
        this.editingId.set(null);
      },
      error: err => {
        this.busyId.set(null);
        this.error.set(toApiError(err).message);
      },
    });
  }

  toggleArchive(category: SignatureCategoryOption): void {
    if (!category.id || this.busyId()) {
      return;
    }
    this.busyId.set(category.id);
    this.error.set('');
    const action = category.isArchived
      ? this.store.unarchiveCategory(category.id)
      : this.store.archiveCategory(category.id);
    action.subscribe({
      next: () => this.busyId.set(null),
      error: err => {
        this.busyId.set(null);
        this.error.set(toApiError(err).message);
      },
    });
  }

  close(): void {
    this.reset();
    this.closed.emit();
  }

  private reset(): void {
    this.editingId.set(null);
    this.busyId.set(null);
    this.error.set('');
  }
}
