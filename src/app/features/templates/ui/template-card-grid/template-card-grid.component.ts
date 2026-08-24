import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Template, TemplateUiStatus } from '../../data-access/templates.model';

/**
 * Grid de tarjetas de plantillas (patrón "Aether"; tarjetas en vez de tabla
 * porque cada plantilla se hojea/previsualiza como un documento): icono
 * circular pastel por categoría, nombre, chip de categoría, chip de estado
 * y fecha. Menú fantasma "..." con Edit/Publish/Archive; el click en el resto
 * de la tarjeta dispara la vista previa de solo lectura.
 *
 * Contra el backend real la categoría es TEXTO LIBRE (no un enum cerrado), así
 * que icono/color se derivan por palabra clave con un fallback neutro. Las
 * plantillas System son de plataforma: se muestran de solo lectura.
 */
@Component({
  selector: 'app-template-card-grid',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './template-card-grid.component.html',
})
export class TemplateCardGridComponent {
  @Input() templates: Template[] = [];
  @Input() emptyMessage = 'No templates match your search';
  @Output() previewRequested = new EventEmitter<Template>();
  @Output() editRequested = new EventEmitter<Template>();
  @Output() publishRequested = new EventEmitter<Template>();
  @Output() archiveRequested = new EventEmitter<Template>();

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

  categoryIcon(category: string): string {
    const key = category.toLowerCase();
    if (key.includes('mail')) return 'mail-outline';
    if (key.includes('letter')) return 'document-text-outline';
    if (key.includes('invoice') || key.includes('billing')) return 'receipt-outline';
    if (key.includes('remind') || key.includes('alert')) return 'alarm-outline';
    return 'documents-outline';
  }

  categoryCircle(category: string): string {
    const key = category.toLowerCase();
    if (key.includes('mail')) return 'bg-[#CFE2F7]';
    if (key.includes('letter')) return 'bg-[#E8F1FB]';
    if (key.includes('invoice') || key.includes('billing')) return 'bg-[#DDE9F5]';
    if (key.includes('remind') || key.includes('alert')) return 'bg-[#E7EAEE]';
    return 'bg-[#E2EDF7]';
  }

  categoryChip(category: string): string {
    const key = category.toLowerCase();
    if (key.includes('mail')) return 'border-indigo-200 text-indigo-600';
    if (key.includes('letter')) return 'border-orange-200 text-orange-500';
    if (key.includes('invoice') || key.includes('billing')) return 'border-[#D7E3EF] text-[#1E466B]';
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

  onPublishClick(template: Template, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.publishRequested.emit(template);
  }

  onArchiveClick(template: Template, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.archiveRequested.emit(template);
  }
}
