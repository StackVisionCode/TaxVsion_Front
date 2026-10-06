import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  TEMPLATE_STATUS_LABEL,
  TEMPLATE_STATUS_PILL,
  Template,
  templateCategoryChip,
} from '../../data-access/templates.model';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';

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
  imports: [CommonModule, DropdownMenuComponent, MenuItemDirective, StatusPillComponent, StateBlockComponent],
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
    if (key.includes('mail')) return 'bg-indigo-100';
    if (key.includes('letter')) return 'bg-indigo-50';
    if (key.includes('invoice') || key.includes('billing')) return 'bg-indigo-100';
    if (key.includes('remind') || key.includes('alert')) return 'bg-gray-200';
    return 'bg-brand-surface-strong';
  }

  readonly categoryChip = templateCategoryChip;
  readonly statusLabel = TEMPLATE_STATUS_LABEL;
  readonly statusPill = TEMPLATE_STATUS_PILL;

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

  onPreviewClick(template: Template): void {
    this.previewRequested.emit(template);
  }
}
