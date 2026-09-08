import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DocumentsClientSummary } from '../../data-access/documents-clients.service';
import { StorageUsageResponse, WorkspaceSection } from '../../data-access/documents.model';

/**
 * Navegador del gestor documental (rail izquierdo). El cliente es un CONTEXTO
 * dentro del workspace (lista con búsqueda), no una pantalla previa: cambiar de
 * cliente es instantáneo y no sale de Documents. Footer con el uso de almacenamiento.
 */
@Component({
  selector: 'app-document-navigator',
  imports: [FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './document-navigator.component.html',
})
export class DocumentNavigatorComponent {
  @Input() section: WorkspaceSection = 'office';
  @Input() activeClientId: string | null = null;
  @Input() clients: DocumentsClientSummary[] = [];
  @Input() clientsTotal = 0;
  @Input() clientSearch = '';
  @Input() clientsLoading = false;
  @Input() usage: StorageUsageResponse | null = null;

  @Output() openOffice = new EventEmitter<void>();
  @Output() openClient = new EventEmitter<DocumentsClientSummary>();
  @Output() openRecent = new EventEmitter<void>();
  @Output() openShared = new EventEmitter<void>();
  @Output() openTrash = new EventEmitter<void>();
  @Output() searchChanged = new EventEmitter<string>();
  @Output() openStorage = new EventEmitter<void>();

  readonly clientsExpanded = signal(true);

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

  onSearch(term: string): void {
    this.searchChanged.emit(term);
  }
}
