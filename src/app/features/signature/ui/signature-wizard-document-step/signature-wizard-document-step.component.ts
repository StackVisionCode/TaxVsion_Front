import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { FileResponse, formatBytes as formatFileBytes } from '@core/cloud-storage/cloud-storage.model';
import { WizardDocKind, WizardDocument } from '../signature-request-panel/signature-wizard.model';
import { formatBytes, kindChip, kindCircle, kindIcon } from '../signature-request-panel/signature-wizard.presenter';
import { SignatureDocumentLibraryComponent } from '../signature-document-library/signature-document-library.component';
import { DocumentValidationIssue, ValidateDocumentResponse } from '../../data-access/signature.model';
import { SignatureStore } from '../../data-access/signature.store';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Fase del pipeline preflight → CloudStorage del documento elegido. */
type UploadPhase = 'idle' | 'validating' | 'uploading' | 'ready' | 'rejected' | 'failed';

/** Origen del documento: subir uno nuevo o reusar un PDF ya existente en la oficina. */
type DocSource = 'upload' | 'library';

/**
 * Paso 2 del wizard: subir el PDF a firmar (click o drag & drop). Al elegir un
 * archivo corre el preflight real (POST /signature/documents/validate: MIME,
 * tamaño, integridad, firmas previas) y, si es aceptable, lo sube a CloudStorage
 * (initiate → MinIO → complete) y conserva el fileId — requisito de
 * POST /signature/requests. El backend solo acepta PDF, así que el picker
 * también. Dos columnas en lg: dropzone a la izquierda, detalle sticky a la derecha.
 */
@Component({
  selector: 'app-signature-wizard-document-step',
  imports: [CommonModule, FormsModule, SignatureDocumentLibraryComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-wizard-document-step.component.html',
  styleUrl: './signature-wizard-document-step.component.css',
})
export class SignatureWizardDocumentStepComponent {
  @Input() selectedId: string | null = null;
  /** Cliente elegido en el paso 1: acota la librería a sus PDF (opcional). */
  @Input() clientId: string | null = null;
  @Output() documentSelected = new EventEmitter<WizardDocument>();
  @Output() documentCleared = new EventEmitter<void>();

  private readonly store = inject(SignatureStore);

  /** Origen del documento: subir o reusar de la oficina. */
  readonly docSource = signal<DocSource>('upload');

  readonly phase = signal<UploadPhase>('idle');
  readonly issues = signal<DocumentValidationIssue[]>([]);
  readonly uploadError = signal('');
  readonly uploaded = signal<WizardDocument | null>(null);
  readonly validation = signal<ValidateDocumentResponse | null>(null);
  readonly isDragging = signal(false);

  /** Token anti-carrera: si el usuario re-elige archivo a mitad del pipeline, el viejo se descarta. */
  private pipelineToken = 0;

  readonly isBusy = (): boolean => this.phase() === 'validating' || this.phase() === 'uploading';

  /** Documento subido, para el panel derecho. */
  selectedDocument(): WizardDocument | null {
    return this.uploaded();
  }

  /** Lista 0-o-1 para *ngFor+trackBy: re-anima el panel al cambiar la selección. */
  selectedAsList(): WizardDocument[] {
    const doc = this.selectedDocument();
    return doc ? [doc] : [];
  }

  trackDocument(_index: number, doc: WizardDocument): string {
    return doc.id;
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
    this.pipelineToken++;
    this.uploaded.set(null);
    this.validation.set(null);
    this.issues.set([]);
    this.uploadError.set('');
    this.phase.set('idle');
    this.documentCleared.emit();
  }

  setDocSource(source: DocSource): void {
    if (this.isBusy()) {
      return;
    }
    this.docSource.set(source);
    this.uploadError.set('');
    this.removeUpload();
  }

  /**
   * Reusar un PDF existente de la oficina: NO se vuelve a subir. Se baja el archivo solo
   * para renderizarlo en el editor de campos (paso 3) y se conserva su `fileId`, que sirve
   * directo como `originalFileId` — el Create promueve Draft→Ready leyendo la proyección.
   */
  async onLibraryPicked(file: FileResponse): Promise<void> {
    if (this.isBusy()) {
      return;
    }
    const token = ++this.pipelineToken;
    this.uploadError.set('');
    this.issues.set([]);
    this.validation.set(null);
    this.uploaded.set(null);
    this.documentCleared.emit();
    this.phase.set('uploading');
    try {
      const url = await firstValueFrom(this.store.getDownloadUrl(file.id));
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`download failed (${response.status})`);
      }
      const blob = await response.blob();
      if (token !== this.pipelineToken) {
        return;
      }
      const doc: WizardDocument = {
        id: file.id,
        name: file.originalName,
        kind: 'pdf',
        size: formatFileBytes(file.sizeBytes),
        date: new Date(file.createdAtUtc).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        blob,
        fileId: file.id,
        pageCount: null,
      };
      this.uploaded.set(doc);
      this.phase.set('ready');
      this.documentSelected.emit(doc);
    } catch {
      if (token !== this.pipelineToken) {
        return;
      }
      this.uploadError.set('Could not load that PDF from the office library. Try another one or upload it.');
      this.phase.set('failed');
    }
  }

  /** Validación local + preflight backend + subida a CloudStorage. */
  private acceptFile(file: File): void {
    if (this.isBusy()) {
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      this.uploadError.set('The file must be smaller than 25MB.');
      return;
    }
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      this.uploadError.set('Only PDF documents can be sent for signature.');
      return;
    }

    const token = ++this.pipelineToken;
    this.uploadError.set('');
    this.issues.set([]);
    this.validation.set(null);
    this.uploaded.set(null);
    this.documentCleared.emit();
    this.phase.set('validating');

    this.store.validateDocument(file).subscribe({
      next: result => {
        if (token !== this.pipelineToken) {
          return;
        }
        this.validation.set(result);
        if (!result.isAcceptable) {
          this.issues.set(result.issues);
          this.phase.set('rejected');
          return;
        }
        this.uploadToStorage(file, result, token);
      },
      error: err => {
        if (token !== this.pipelineToken) {
          return;
        }
        this.uploadError.set(toApiError(err).message);
        this.phase.set('failed');
      },
    });
  }

  private uploadToStorage(file: File, validation: ValidateDocumentResponse, token: number): void {
    this.phase.set('uploading');
    this.store.uploadOriginalDocument(file, validation.validationRecordId).subscribe({
      next: fileId => {
        if (token !== this.pipelineToken) {
          return;
        }
        const doc: WizardDocument = {
          id: fileId,
          name: file.name,
          kind: 'pdf',
          size: formatBytes(file.size),
          date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          blob: file,
          fileId,
          pageCount: validation.pageCount,
        };
        this.uploaded.set(doc);
        this.phase.set('ready');
        this.documentSelected.emit(doc);
      },
      error: err => {
        if (token !== this.pipelineToken) {
          return;
        }
        this.uploadError.set(toApiError(err).message);
        this.phase.set('failed');
      },
    });
  }
}
