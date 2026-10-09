import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { FileResponse } from '@core/cloud-storage/cloud-storage.model';
import { formatBytes } from '@shared/utils/format.util';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { DropzoneComponent, DropzoneRejection } from '@shared/ui/dropzone/dropzone.component';
import { SignatureDocumentLibraryComponent } from '../signature-document-library/signature-document-library.component';
import { SignatureStore } from '../../data-access/signature.store';
import { DocumentValidationIssue, ValidateDocumentResponse } from '../../data-access/signature.model';
import { WizardDocument } from '../signature-request-panel/signature-wizard.model';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type DocSource = 'upload' | 'library';
type Phase = 'idle' | 'validating' | 'uploading' | 'rejected' | 'failed';

/**
 * F9 — Modal de reemplazo del PDF de un documento del borrador. Reutiliza la misma UX del Step 2:
 * dos pestañas (Upload / Office library), preflight real, y una vista previa del cambio
 * (viejo → nuevo) con aviso explícito cuando el número de páginas cambia — por spec F9: "nunca
 * conservar en silencio". El padre decide qué hacer con el nuevo WizardDocument (swap local o
 * PUT backend).
 */
@Component({
  selector: 'app-signature-replace-document-dialog',
  imports: [CommonModule, ModalComponent, DropzoneComponent, SignatureDocumentLibraryComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-replace-document-dialog.component.html',
})
export class SignatureReplaceDocumentDialogComponent implements OnChanges {
  private readonly store = inject(SignatureStore);

  @Input() isOpen = false;
  /** Documento que se va a reemplazar (muestra su nombre y page count en el header). */
  @Input() currentDocument: WizardDocument | null = null;
  /** Cliente activo del wizard: acota la librería a sus PDF. */
  @Input() clientId: string | null = null;
  /** fileIds que ya forman parte de la request; se filtran de la librería para evitar duplicados. */
  @Input() excludedFileIds: readonly string[] = [];
  /** true = el padre está corriendo la llamada backend; deshabilita acciones. */
  @Input() submitting = false;

  @Output() replace = new EventEmitter<WizardDocument>();
  @Output() cancelled = new EventEmitter<void>();

  readonly MAX_UPLOAD_BYTES = MAX_UPLOAD_BYTES;
  readonly docSource = signal<DocSource>('upload');
  readonly phase = signal<Phase>('idle');
  readonly issues = signal<DocumentValidationIssue[]>([]);
  readonly errorMessage = signal('');
  /** Candidato listo para reemplazar (fileId ya subido o reusado de library). */
  readonly candidate = signal<WizardDocument | null>(null);

  private pipelineToken = 0;

  readonly busy = (): boolean =>
    this.submitting || this.phase() === 'validating' || this.phase() === 'uploading';

  readonly pageCountChanged = computed(() => {
    const c = this.candidate();
    const old = this.currentDocument;
    return !!c && !!old && c.pageCount != null && old.pageCount != null && c.pageCount !== old.pageCount;
  });

  readonly canReplace = computed(() => !!this.candidate() && !this.busy());

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      if (this.isOpen) {
        // Al abrir, resetea para no mostrar un candidato de la vez anterior.
        this.reset();
      }
    }
  }

  setDocSource(source: DocSource): void {
    if (this.busy()) return;
    this.docSource.set(source);
    this.errorMessage.set('');
    this.candidate.set(null);
    this.issues.set([]);
    this.phase.set('idle');
  }

  onFiles(files: File[]): void {
    const file = files[0];
    if (file) this.acceptFile(file);
  }

  onRejected(rejections: DropzoneRejection[]): void {
    const first = rejections[0];
    if (!first) return;
    this.errorMessage.set(
      first.reason === 'size'
        ? 'The file must be smaller than 25MB.'
        : 'Only PDF documents can be sent for signature.',
    );
  }

  async onLibraryPicked(file: FileResponse): Promise<void> {
    if (this.busy()) return;
    if (this.isAlreadyInRequest(file.id)) {
      this.errorMessage.set('That PDF is already in this signature request.');
      return;
    }
    const token = ++this.pipelineToken;
    this.errorMessage.set('');
    this.issues.set([]);
    this.phase.set('uploading');
    try {
      const url = await firstValueFrom(this.store.getDownloadUrl(file.id));
      const response = await fetch(url);
      if (!response.ok) throw new Error(`download failed (${response.status})`);
      const blob = await response.blob();
      if (token !== this.pipelineToken) return;
      this.candidate.set({
        id: file.id,
        name: file.originalName,
        kind: 'pdf',
        size: formatBytes(file.sizeBytes),
        date: new Date(file.createdAtUtc).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        blob,
        fileId: file.id,
        // Library no reporta pageCount; queda null → el backend decide (no invalida si falta dato).
        pageCount: null,
      });
      this.phase.set('idle');
    } catch (err) {
      if (token !== this.pipelineToken) return;
      this.errorMessage.set(`Could not load that PDF: ${toApiError(err).message}`);
      this.phase.set('failed');
    }
  }

  clearCandidate(): void {
    this.pipelineToken++;
    this.candidate.set(null);
    this.phase.set('idle');
    this.errorMessage.set('');
    this.issues.set([]);
  }

  confirmReplace(): void {
    const candidate = this.candidate();
    if (!candidate || this.busy()) return;
    this.replace.emit(candidate);
  }

  closeModal(): void {
    if (this.busy()) return;
    this.cancelled.emit();
  }

  private reset(): void {
    this.pipelineToken++;
    this.docSource.set('upload');
    this.phase.set('idle');
    this.issues.set([]);
    this.errorMessage.set('');
    this.candidate.set(null);
  }

  private isAlreadyInRequest(fileId: string): boolean {
    return this.excludedFileIds.some((id) => id === fileId);
  }

  private acceptFile(file: File): void {
    if (this.busy()) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      this.errorMessage.set('The file must be smaller than 25MB.');
      return;
    }
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      this.errorMessage.set('Only PDF documents can be sent for signature.');
      return;
    }
    const token = ++this.pipelineToken;
    this.errorMessage.set('');
    this.issues.set([]);
    this.candidate.set(null);
    this.phase.set('validating');

    this.store.validateDocument(file).subscribe({
      next: (validation) => {
        if (token !== this.pipelineToken) return;
        if (!validation.isAcceptable) {
          this.issues.set(validation.issues);
          this.phase.set('rejected');
          return;
        }
        this.uploadToStorage(file, validation, token);
      },
      error: (err) => {
        if (token !== this.pipelineToken) return;
        this.errorMessage.set(toApiError(err).message);
        this.phase.set('failed');
      },
    });
  }

  private uploadToStorage(file: File, validation: ValidateDocumentResponse, token: number): void {
    this.phase.set('uploading');
    this.store.uploadOriginalDocument(file, validation.validationRecordId).subscribe({
      next: (fileId) => {
        if (token !== this.pipelineToken) return;
        this.candidate.set({
          id: fileId,
          name: file.name,
          kind: 'pdf',
          size: formatBytes(file.size),
          date: new Date().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
          blob: file,
          fileId,
          pageCount: validation.pageCount,
        });
        this.phase.set('idle');
      },
      error: (err) => {
        if (token !== this.pipelineToken) return;
        this.errorMessage.set(toApiError(err).message);
        this.phase.set('failed');
      },
    });
  }
}
