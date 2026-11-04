import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  signal,
} from '@angular/core';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { UploadPolicy } from '@core/cloud-storage/cloud-storage.model';
import { DropzoneComponent, DropzoneRejection } from '@shared/ui/dropzone/dropzone.component';
import { formatBytes } from '@shared/utils/format.util';

/**
 * Diálogo de subida: arrastrar-soltar o elegir archivos, con el contexto donde
 * caerán (dueño, carpeta, año fiscal). El ciclo de escaneo (Processing → Ready)
 * lo muestra la lista de archivos una vez subidos, no este diálogo.
 */
@Component({
  selector: 'app-upload-dialog',
  imports: [ModalComponent, DropzoneComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <app-modal [isOpen]="isOpen" heading="Upload files" size="lg" (closed)="cancelled.emit()">
      <div class="mt-5 grid grid-cols-3 gap-3">
        <div>
          <p class="text-[0.625rem] font-bold uppercase tracking-wider text-gray-400">Owner</p>
          <p class="mt-0.5 truncate text-sm font-semibold text-gray-800">{{ ownerLabel }}</p>
        </div>
        <div>
          <p class="text-[0.625rem] font-bold uppercase tracking-wider text-gray-400">Folder</p>
          <p class="mt-0.5 truncate text-sm font-semibold text-gray-800">{{ folderLabel }}</p>
        </div>
        <div>
          <p class="text-[0.625rem] font-bold uppercase tracking-wider text-gray-400">Tax year</p>
          <p class="mt-0.5 text-sm font-semibold text-gray-800">{{ taxYear }}</p>
        </div>
      </div>

      <app-dropzone class="mt-4" label="Drag files here" [hint]="hint()" [accept]="policy?.accept ?? ''"
        [maxBytes]="policy?.maxFileSizeBytes ?? 0" (files)="add($event)" (rejected)="reject($event)" />

      @if (rejections().length > 0) {
        <ul class="mt-2 space-y-0.5" role="alert">
          @for (rejection of rejections(); track rejection.message) {
            <li class="text-xs text-red-600">{{ rejection.message }}</li>
          }
        </ul>
      }

      @if (staged().length > 0) {
        <div class="mt-3 divide-y divide-gray-100">
          @for (file of staged(); track file.name + file.size) {
            <div class="flex items-center gap-3 py-2.5">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-500">
                <ion-icon name="document-text-outline"></ion-icon>
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold text-gray-800">{{ file.name }}</p>
                <p class="text-xs text-gray-400">{{ size(file) }}</p>
              </div>
              <button type="button" (click)="remove(file)" aria-label="Remove"
                class="grid h-8 w-8 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
                <ion-icon name="close-outline"></ion-icon>
              </button>
            </div>
          }
        </div>
      }

      <div class="mt-6 flex items-center justify-end gap-2">
        <button type="button" (click)="cancelled.emit()"
          class="rounded-full px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900">
          Cancel
        </button>
        <button type="button" (click)="upload()" [disabled]="staged().length === 0"
          class="rounded-full bg-brand-bold px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-ink disabled:cursor-not-allowed disabled:opacity-50">
          {{ uploadLabel() }}
        </button>
      </div>
    </app-modal>
  `,
})
export class UploadDialogComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() ownerLabel = '';
  @Input() folderLabel = '';
  @Input() taxYear = new Date().getFullYear();
  /** Qué admite la carpeta (`GET /storage/upload-policy`); sin ella el dropzone no filtra y valida el backend. */
  @Input() policy: UploadPolicy | null = null;
  @Output() uploaded = new EventEmitter<File[]>();
  @Output() cancelled = new EventEmitter<void>();

  readonly staged = signal<File[]>([]);
  readonly rejections = signal<DropzoneRejection[]>([]);

  ngOnChanges(): void {
    if (this.isOpen) {
      this.staged.set([]);
      this.rejections.set([]);
    }
  }

  /** "Up to 25 MB · .pdf, .docx, .xlsx…" desde la política; genérico mientras no llega. */
  hint(): string {
    if (!this.policy) {
      return 'PDF, images, spreadsheets and documents';
    }
    const types = this.policy.allowedExtensions;
    const shown = types.slice(0, 8).join(', ');
    const more = types.length > 8 ? ` and ${types.length - 8} more` : '';
    return `Up to ${formatBytes(this.policy.maxFileSizeBytes, { maxUnit: 'GB' })} · ${shown}${more}`;
  }

  reject(rejections: DropzoneRejection[]): void {
    this.rejections.set(rejections);
  }

  size(file: File): string {
    return formatBytes(file.size);
  }

  uploadLabel(): string {
    const n = this.staged().length;
    return n === 0 ? 'Upload' : n === 1 ? 'Upload 1 file' : `Upload ${n} files`;
  }

  add(files: File[]): void {
    this.rejections.set([]);
    this.staged.update(current => [...current, ...files]);
  }

  remove(file: File): void {
    this.staged.update(current => current.filter(f => f !== file));
  }

  upload(): void {
    if (this.staged().length > 0) {
      this.uploaded.emit(this.staged());
    }
  }
}
