import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export type TemplateCategory = 'Email' | 'Letter' | 'Invoice Note' | 'Reminder';
export type TemplateStatus = 'published' | 'draft';

export interface Template {
  id: string;
  name: string;
  category: TemplateCategory;
  status: TemplateStatus;
  body: string;
  /** ISO date string (YYYY-MM-DD). */
  updatedAt: string;
}

/**
 * Grid de tarjetas de plantillas (patrón "Aether"; tarjetas en vez de tabla
 * porque cada plantilla se hojea/previsualiza como un documento): icono
 * circular pastel por categoría, nombre, chip de categoría, chip de estado
 * (Published/Draft) y fecha de última edición. Menú fantasma "..." con
 * Edit/Duplicate/Delete; el click en el resto de la tarjeta dispara la
 * vista previa de solo lectura en la página contenedora.
 */
@Component({
  selector: 'app-template-card-grid',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './template-card-grid.component.html',
})
export class TemplateCardGridComponent {
  @Input() templates: Template[] = [];
  @Output() previewRequested = new EventEmitter<Template>();
  @Output() editRequested = new EventEmitter<Template>();
  @Output() duplicateRequested = new EventEmitter<Template>();
  @Output() deleteRequested = new EventEmitter<Template>();

  readonly openMenuId = signal<string | null>(null);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="template-menu"]')) {
      this.openMenuId.set(null);
    }
  }

  trackByTemplateId(_index: number, template: Template): string {
    return template.id;
  }

  categoryIcon(category: TemplateCategory): string {
    switch (category) {
      case 'Email':
        return 'mail-outline';
      case 'Letter':
        return 'document-text-outline';
      case 'Invoice Note':
        return 'receipt-outline';
      case 'Reminder':
        return 'alarm-outline';
    }
  }

  categoryCircle(category: TemplateCategory): string {
    switch (category) {
      case 'Email':
        return 'bg-[#CBD9F2]';
      case 'Letter':
        return 'bg-[#F2E3C9]';
      case 'Invoice Note':
        return 'bg-[#EEEBFA]';
      case 'Reminder':
        return 'bg-[#DCDCDC]';
    }
  }

  categoryChip(category: TemplateCategory): string {
    switch (category) {
      case 'Email':
        return 'border-indigo-200 text-indigo-600';
      case 'Letter':
        return 'border-orange-200 text-orange-500';
      case 'Invoice Note':
        return 'border-[#D6CEF4] text-[#7C6AE0]';
      case 'Reminder':
        return 'border-gray-300 text-gray-500';
    }
  }

  statusChip(status: TemplateStatus): string {
    return status === 'published' ? 'border-emerald-200 text-emerald-600' : 'border-gray-300 text-gray-500';
  }

  statusLabel(status: TemplateStatus): string {
    return status === 'published' ? 'Published' : 'Draft';
  }

  formatDate(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  toggleMenu(template: Template, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(this.openMenuId() === template.id ? null : template.id);
  }

  onMenuClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  onPreviewClick(template: Template): void {
    this.previewRequested.emit(template);
  }

  onEditClick(template: Template, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.editRequested.emit(template);
  }

  onDuplicateClick(template: Template, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.duplicateRequested.emit(template);
  }

  onDeleteClick(template: Template, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.deleteRequested.emit(template);
  }
}
