import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Template, TemplateUiStatus } from '../../data-access/templates.model';

/**
 * Vista previa de solo lectura de una plantilla (patrón "takeover", intercambiado
 * con la grilla vía *ngIf/else en la página): encabezado con clave/categoría/estado,
 * las variables declaradas y el cuerpo de la versión publicada.
 *
 * El cuerpo NO viene con la plantilla: la página lo baja de CloudStorage y lo pasa
 * por @Input, por eso hay estados propios de carga y error. Se muestra como texto
 * (no se inyecta HTML) para no ejecutar contenido de la plantilla en el panel.
 */
@Component({
  selector: 'app-template-preview',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './template-preview.component.html',
})
export class TemplatePreviewComponent {
  @Input() template: Template | null = null;
  @Input() body: string | null = null;
  @Input() bodyLoading = false;
  @Input() bodyError: string | null = null;
  @Output() back = new EventEmitter<void>();
  @Output() editRequested = new EventEmitter<Template>();
  @Output() retryBody = new EventEmitter<Template>();

  categoryChip(category: string): string {
    const key = category.toLowerCase();
    if (key.includes('mail')) return 'border-indigo-200 text-indigo-600';
    if (key.includes('letter')) return 'border-orange-200 text-orange-500';
    if (key.includes('invoice') || key.includes('billing')) return 'border-[#D7E3EF] text-brand-bold';
    if (key.includes('remind') || key.includes('alert')) return 'border-gray-300 text-gray-500';
    return 'border-gray-200 text-gray-500';
  }

  statusChip(status: TemplateUiStatus): string {
    switch (status) {
      case 'published':
        return 'border-emerald-200 text-emerald-600';
      case 'archived':
        return 'border-gray-200 text-gray-400';
      case 'draft':
        return 'border-gray-300 text-gray-500';
    }
  }

  statusDot(status: TemplateUiStatus): string {
    return status === 'published' ? 'bg-emerald-500' : 'bg-gray-400';
  }

  statusLabel(status: TemplateUiStatus): string {
    switch (status) {
      case 'published':
        return 'Published';
      case 'archived':
        return 'Archived';
      case 'draft':
        return 'Draft';
    }
  }

  formatDate(iso: string): string {
    if (!iso) {
      return '—';
    }
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  goBack(): void {
    this.back.emit();
  }

  edit(template: Template): void {
    this.editRequested.emit(template);
  }

  retry(template: Template): void {
    this.retryBody.emit(template);
  }
}
