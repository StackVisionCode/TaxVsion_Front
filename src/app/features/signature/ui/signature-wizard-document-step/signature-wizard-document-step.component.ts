import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WizardDocKind, WizardDocument } from '../signature-request-panel/signature-wizard.model';
import {
  WIZARD_DOCUMENTS,
  formatBytes,
  kindChip,
  kindCircle,
  kindFromName,
  kindIcon,
} from '../signature-request-panel/signature-wizard.mock';

type DocTab = 'existing' | 'upload';
type KindFilter = 'all' | 'pdf' | 'doc';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Paso 2 del wizard: elegir un documento existente (mock) o subir uno
 * (click o drag & drop). Dos columnas en lg: lista/dropzone a la izquierda,
 * panel sticky con el detalle del documento seleccionado a la derecha.
 */
@Component({
  selector: 'app-signature-wizard-document-step',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-wizard-document-step.component.html',
  styleUrl: './signature-wizard-document-step.component.css',
})
export class SignatureWizardDocumentStepComponent {
  @Input() selectedId: string | null = null;
  @Output() documentSelected = new EventEmitter<WizardDocument>();

  readonly documents = WIZARD_DOCUMENTS;
  readonly tab = signal<DocTab>('existing');
  readonly kindFilters: KindFilter[] = ['all', 'pdf', 'doc'];
  readonly kindFilter = signal<KindFilter>('all');
  readonly search = signal('');
  readonly uploaded = signal<WizardDocument | null>(null);
  readonly uploadError = signal('');
  readonly isDragging = signal(false);

  readonly filtered = computed<WizardDocument[]>(() => {
    const filter = this.kindFilter();
    const query = this.search().trim().toLowerCase();
    return this.documents
      .filter(doc => filter === 'all' || doc.kind === filter)
      .filter(doc => !query || doc.name.toLowerCase().includes(query));
  });

  /** Documento seleccionado (de la lista o el subido) para el panel derecho. */
  selectedDocument(): WizardDocument | null {
    if (this.uploaded()?.id === this.selectedId) {
      return this.uploaded();
    }
    return this.documents.find(doc => doc.id === this.selectedId) ?? null;
  }

  /** Lista 0-o-1 para *ngFor+trackBy: re-anima el panel al cambiar la selección. */
  selectedAsList(): WizardDocument[] {
    const doc = this.selectedDocument();
    return doc ? [doc] : [];
  }

  trackDocument(_index: number, doc: WizardDocument): string {
    return doc.id;
  }

  setTab(tab: DocTab): void {
    this.tab.set(tab);
  }

  setKindFilter(filter: KindFilter): void {
    this.kindFilter.set(filter);
  }

  filterLabel(filter: KindFilter): string {
    switch (filter) {
      case 'all':
        return 'All';
      case 'pdf':
        return 'PDF';
      case 'doc':
        return 'Word';
    }
  }

  icon(kind: WizardDocKind): string {
    return kindIcon(kind);
  }

  circle(kind: WizardDocKind): string {
    return kindCircle(kind);
  }

  chip(kind: WizardDocKind): string {
    return kindChip(kind);
  }

  select(doc: WizardDocument): void {
    this.documentSelected.emit(doc);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.acceptFile(file);
    }
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(): void {
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.acceptFile(file);
    }
  }

  removeUpload(): void {
    this.uploaded.set(null);
    this.uploadError.set('');
  }

  /** Validación compartida entre input y drag & drop. */
  private acceptFile(file: File): void {
    if (file.size > MAX_UPLOAD_BYTES) {
      this.uploadError.set('El archivo debe pesar menos de 25MB.');
      return;
    }
    const kind = kindFromName(file.name);
    if (kind !== 'pdf' && kind !== 'doc') {
      this.uploadError.set('Solo se permiten PDF, DOC o DOCX.');
      return;
    }
    this.uploadError.set('');
    const doc: WizardDocument = {
      id: `upload-${file.name}-${file.size}`,
      name: file.name,
      kind,
      size: formatBytes(file.size),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      blob: file,
    };
    this.uploaded.set(doc);
    this.select(doc);
  }
}
