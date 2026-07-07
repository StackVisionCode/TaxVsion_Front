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
import { Template, TemplateCategory, TemplateStatus } from '../template-card-grid/template-card-grid.component';

const CATEGORIES: TemplateCategory[] = ['Email', 'Letter', 'Invoice Note', 'Reminder'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Overlay de creación/edición de plantillas (mismo patrón que
 * task-create-panel): tarjeta centrada `rounded-[28px]` sobre backdrop con
 * stopPropagation. Un único componente cubre ambos modos: si `template`
 * llega con datos precarga el formulario y actúa como edición ("Edit
 * template" / "Save changes"); si es null arranca vacío ("New template" /
 * "Create template").
 */
@Component({
  selector: 'app-template-form-panel',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './template-form-panel.component.html',
})
export class TemplateFormPanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() template: Template | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Template>();

  readonly categories = CATEGORIES;

  readonly name = signal('');
  readonly category = signal<TemplateCategory>('Email');
  readonly status = signal<TemplateStatus>('draft');
  readonly body = signal('');

  readonly isCategoryOpen = signal(false);

  /** Signal propia porque `template` es un @Input plano: un computed() no reaccionaría a sus cambios (se congelaría). */
  readonly isEditMode = signal(false);
  readonly canSave = computed(() => this.name().trim().length > 0 && this.body().trim().length > 0);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['template'] || changes['isOpen']) {
      this.isEditMode.set(this.template !== null);
      this.resetForm();
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

  selectCategory(category: TemplateCategory): void {
    this.category.set(category);
    this.isCategoryOpen.set(false);
  }

  setStatus(status: TemplateStatus): void {
    this.status.set(status);
  }

  close(): void {
    this.closed.emit();
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }
    const result: Template = {
      id: this.template?.id ?? `template-${Date.now()}`,
      name: this.name().trim(),
      category: this.category(),
      status: this.status(),
      body: this.body().trim(),
      updatedAt: todayIso(),
    };
    this.saved.emit(result);
  }

  private resetForm(): void {
    const template = this.template;
    if (template) {
      this.name.set(template.name);
      this.category.set(template.category);
      this.status.set(template.status);
      this.body.set(template.body);
    } else {
      this.name.set('');
      this.category.set('Email');
      this.status.set('draft');
      this.body.set('');
    }
    this.isCategoryOpen.set(false);
  }
}
