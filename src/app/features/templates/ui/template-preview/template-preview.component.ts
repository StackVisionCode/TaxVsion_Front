import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Template, TemplateCategory, TemplateStatus } from '../template-card-grid/template-card-grid.component';

/**
 * Vista previa de solo lectura de una plantilla (mismo patrón "takeover" que
 * invoice-preview, intercambiado con la grilla vía *ngIf/else en la
 * página): encabezado con nombre/categoría/estado/fecha, tarjeta con el
 * contenido del cuerpo y acciones Duplicate/Edit. "Edit" emite un evento
 * que la página escucha para reabrir el panel de formulario en modo edición.
 */
@Component({
  selector: 'app-template-preview',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './template-preview.component.html',
})
export class TemplatePreviewComponent {
  @Input() template: Template | null = null;
  @Output() back = new EventEmitter<void>();
  @Output() duplicateRequested = new EventEmitter<Template>();
  @Output() editRequested = new EventEmitter<Template>();

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

  statusDot(status: TemplateStatus): string {
    return status === 'published' ? 'bg-emerald-500' : 'bg-gray-400';
  }

  statusLabel(status: TemplateStatus): string {
    return status === 'published' ? 'Published' : 'Draft';
  }

  formatDate(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  goBack(): void {
    this.back.emit();
  }

  duplicate(template: Template): void {
    this.duplicateRequested.emit(template);
  }

  edit(template: Template): void {
    this.editRequested.emit(template);
  }
}
