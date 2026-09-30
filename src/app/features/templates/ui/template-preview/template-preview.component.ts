import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  TEMPLATE_STATUS_LABEL,
  TEMPLATE_STATUS_PILL,
  Template,
  templateCategoryChip,
} from '../../data-access/templates.model';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';

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
  imports: [CommonModule, StatusPillComponent, StateBlockComponent],
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

  readonly categoryChip = templateCategoryChip;
  readonly statusLabel = TEMPLATE_STATUS_LABEL;
  readonly statusPill = TEMPLATE_STATUS_PILL;

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
