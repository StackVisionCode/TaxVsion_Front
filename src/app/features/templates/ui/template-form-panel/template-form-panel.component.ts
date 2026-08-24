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
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { Template, TemplateFormValue } from '../../data-access/templates.model';

/** Sugerencias de categoría; en el backend el campo es texto libre, no un enum. */
const CATEGORY_SUGGESTIONS = ['Email', 'Letter', 'Invoice Note', 'Reminder'];

/**
 * Overlay de creación/edición de plantillas. Un único componente cubre ambos modos.
 *
 * Ajustes impuestos por el contrato real:
 *  - La identidad es `templateKey` (único por scope) e INMUTABLE: en edición se muestra
 *    deshabilitado, porque el backend no tiene endpoint para renombrar.
 *  - Guardar el cuerpo siempre crea una VERSIÓN nueva (no hay update in-place), y
 *    publicar es un paso explícito: por eso el checkbox "Publish this version".
 *  - Metadata (subject/description/category) solo se envía al CREAR: el controller no
 *    expone actualización de metadata, únicamente versiones del cuerpo.
 * Solo emite un TemplateFormValue: las llamadas las orquesta TemplatesStore.
 */
@Component({
  selector: 'app-template-form-panel',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './template-form-panel.component.html',
})
export class TemplateFormPanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() template: Template | null = null;
  /** Cuerpo ya descargado de CloudStorage (null mientras carga). */
  @Input() body: string | null = null;
  @Input() bodyLoading = false;
  @Input() saving = false;
  @Input() errorMessage: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<TemplateFormValue>();

  readonly categorySuggestions = CATEGORY_SUGGESTIONS;

  readonly templateKey = signal('');
  readonly subject = signal('');
  readonly description = signal('');
  readonly category = signal('');
  readonly bodyDraft = signal('');
  readonly publish = signal(true);

  readonly isCategoryOpen = signal(false);

  /** Signal propia porque `template` es un @Input plano: un computed() no reaccionaría a sus cambios. */
  readonly isEditMode = signal(false);

  readonly canSave = computed(
    () =>
      this.templateKey().trim().length > 0 &&
      this.subject().trim().length > 0 &&
      this.bodyDraft().trim().length > 0 &&
      !this.saving,
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['template'] || changes['isOpen']) {
      this.isEditMode.set(this.template !== null);
      this.resetForm();
    }
    // El cuerpo llega asincrónico (detalle + descarga de CloudStorage): al llegar
    // se precarga, salvo que el usuario ya haya empezado a escribir.
    if (changes['body'] && this.body !== null && !this.bodyDraft()) {
      this.bodyDraft.set(this.body);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="template-category"]')) {
      this.isCategoryOpen.set(false);
    }
  }

  toggleCategoryDropdown(): void {
    this.isCategoryOpen.set(!this.isCategoryOpen());
  }

  selectCategory(category: string): void {
    this.category.set(category);
    this.isCategoryOpen.set(false);
  }

  togglePublish(): void {
    this.publish.set(!this.publish());
  }

  close(): void {
    this.closed.emit();
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }
    this.saved.emit({
      templateKey: this.templateKey().trim(),
      subject: this.subject().trim(),
      description: this.description().trim(),
      category: this.category().trim(),
      body: this.bodyDraft(),
      publish: this.publish(),
    });
  }

  private resetForm(): void {
    const template = this.template;
    if (template) {
      this.templateKey.set(template.templateKey);
      this.subject.set(template.subject);
      this.description.set(template.description);
      this.category.set(template.category);
      this.bodyDraft.set(this.body ?? '');
    } else {
      this.templateKey.set('');
      this.subject.set('');
      this.description.set('');
      this.category.set('');
      this.bodyDraft.set('');
    }
    this.publish.set(true);
    this.isCategoryOpen.set(false);
  }
}
