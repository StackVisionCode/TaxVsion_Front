import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { StorageUsageResponse, WorkspaceSection } from '../../data-access/documents.model';

/**
 * Navegador del gestor documental (rail izquierdo). El cliente sigue siendo un CONTEXTO
 * dentro del workspace, no un módulo aparte: se elige en el selector (sección `clients`) y
 * se vuelve desde el propio rail, sin salir de Documents. Footer con el uso de
 * almacenamiento.
 */
@Component({
  selector: 'app-document-navigator',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './document-navigator.component.html',
})
export class DocumentNavigatorComponent {
  @Input() section: WorkspaceSection = 'office';
  @Input() activeClientName: string | null = null;
  @Input() clientsTotal = 0;
  @Input() usage: StorageUsageResponse | null = null;

  @Output() openOffice = new EventEmitter<void>();
  @Output() openClients = new EventEmitter<void>();
  @Output() openRecent = new EventEmitter<void>();
  @Output() openShared = new EventEmitter<void>();
  @Output() openTrash = new EventEmitter<void>();
  @Output() openStorage = new EventEmitter<void>();

  initials(name: string): string {
    return name
      .split(' ')
      .map(part => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  get usedGb(): string {
    return this.usage ? (this.usage.usedBytes / 1024 ** 3).toFixed(1) : '0.0';
  }

  get maxGb(): string {
    return this.usage ? (this.usage.maxBytes / 1024 ** 3).toFixed(0) : '—';
  }

  get usedPercent(): number {
    if (!this.usage || this.usage.maxBytes === 0) {
      return 0;
    }
    return Math.min(100, Math.round((this.usage.usedBytes / this.usage.maxBytes) * 100));
  }
}
