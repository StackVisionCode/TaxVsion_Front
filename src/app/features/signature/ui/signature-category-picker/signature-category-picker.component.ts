import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { SignatureCategoryOption, signatureCategoryLabel } from '../../data-access/signature.model';
import { SignatureStore } from '../../data-access/signature.store';

/**
 * Selector de categoría reusable (14.5): lista las de sistema + las custom del tenant (traídas del
 * backend) y, si `allowCreate`, permite crear una nueva en línea y seleccionarla al vuelo. La categoría
 * actual siempre aparece aunque sea una custom archivada, para no perder la selección de un borrador.
 */
@Component({
  selector: 'app-signature-category-picker',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-category-picker.component.html',
})
export class SignatureCategoryPickerComponent implements OnInit {
  @Input() value = 'Fiscal';
  @Input() allowCreate = false;
  @Output() valueChange = new EventEmitter<string>();

  readonly store = inject(SignatureStore);

  readonly adding = signal(false);
  readonly newName = signal('');
  readonly saving = signal(false);
  readonly error = signal('');

  readonly label = signatureCategoryLabel;

  ngOnInit(): void {
    this.store.loadCategories();
  }

  /** Categorías activas; incluye el valor actual si no está (custom/archivada) para no perderlo. */
  options(): SignatureCategoryOption[] {
    const active = this.store.activeCategories();
    const current = (this.value ?? '').trim();
    if (current.length > 0 && !active.some(c => c.name === current)) {
      return [{ id: null, name: current, isSystem: false, isArchived: false }, ...active];
    }
    return active;
  }

  onSelect(name: string): void {
    this.valueChange.emit(name);
  }

  openAdd(): void {
    this.newName.set('');
    this.error.set('');
    this.adding.set(true);
  }

  cancelAdd(): void {
    this.adding.set(false);
  }

  confirmAdd(): void {
    const name = this.newName().trim();
    if (name.length < 2 || this.saving()) {
      this.error.set('Enter a category name (2+ characters).');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.store.createCategory(name).subscribe({
      next: created => {
        this.saving.set(false);
        this.adding.set(false);
        this.valueChange.emit(created.name); // selecciona la recién creada
      },
      error: err => {
        this.saving.set(false);
        this.error.set(toApiError(err).message);
      },
    });
  }
}
