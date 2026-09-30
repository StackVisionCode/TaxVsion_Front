import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnChanges, Output, SimpleChanges, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import {
  ClientDocumentItem,
  ClientFolderCrumb,
  ClientFolderItem,
  folderNameError,
} from '../../data-access/client-documents.model';

/** Diálogo de nombre de carpeta (crear o renombrar), controlado por el contenedor. */
export interface FolderNameDialogState {
  mode: 'create' | 'rename';
  /** Solo en rename. */
  folderId: string | null;
  initialName: string;
}

/** Permisos de CloudStorage ya resueltos por el contenedor. */
export interface ClientDocumentsCaps {
  canView: boolean;
  canUpload: boolean;
  canDownload: boolean;
  canDelete: boolean;
  /** `cloudstorage.folder.manage`: crear y renombrar carpetas. */
  canManageFolders: boolean;
}

/**
 * Pestaña "Documents" del perfil de cliente — PRESENTACIONAL. Explorador de las carpetas del
 * cliente en CloudStorage: breadcrumbs, subcarpetas, archivos, subida (botón o arrastrar),
 * descarga, vista previa, borrado, crear y renombrar carpetas. Todo el HTTP y el estado viven en
 * `ClientDocumentsStore`, que conecta el contenedor `app-client-documents-panel`.
 *
 * Renombrar ARCHIVOS no se ofrece: CloudStorage no tiene ese endpoint (solo carpetas).
 */
@Component({
  selector: 'app-client-profile-documents',
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-documents.component.html',
  styleUrl: './client-profile-documents.component.css',
})
export class ClientProfileDocumentsComponent implements OnChanges {
  @Input() clientName = '';
  @Input() folders: ClientFolderItem[] = [];
  @Input() documents: ClientDocumentItem[] = [];
  @Input() path: ClientFolderCrumb[] = [];
  @Input() loading = false;
  @Input() error: string | null = null;
  @Input() maybeTruncated = false;
  @Input() uploading = false;
  @Input() busyIds: ReadonlySet<string> = new Set();
  @Input() caps: ClientDocumentsCaps = {
    canView: false,
    canUpload: false,
    canDownload: false,
    canDelete: false,
    canManageFolders: false,
  };
  @Input() folderDialog: FolderNameDialogState | null = null;
  @Input() savingFolder = false;

  @Output() openFolder = new EventEmitter<ClientFolderItem>();
  /** Índice del breadcrumb (-1 = raíz). */
  @Output() goToCrumb = new EventEmitter<number>();
  @Output() upload = new EventEmitter<File[]>();
  @Output() download = new EventEmitter<ClientDocumentItem>();
  /** Vista previa: el contenedor abre el visor global (`app-file-viewer`). */
  @Output() preview = new EventEmitter<ClientDocumentItem>();
  @Output() remove = new EventEmitter<ClientDocumentItem>();
  @Output() retry = new EventEmitter<void>();
  @Output() requestCreateFolder = new EventEmitter<void>();
  @Output() requestRenameFolder = new EventEmitter<ClientFolderItem>();
  @Output() submitFolderName = new EventEmitter<string>();
  @Output() cancelFolderDialog = new EventEmitter<void>();

  readonly isDragging = signal(false);
  readonly pendingDelete = signal<ClientDocumentItem | null>(null);
  readonly pendingDeleteMessage = computed(() => {
    const doc = this.pendingDelete();
    return doc ? `"${doc.name}" will be moved to the recycle bin.` : '';
  });

  readonly folderName = signal('');
  readonly folderNameErr = signal<string | null>(null);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['folderDialog']) {
      this.folderName.set(this.folderDialog?.initialName ?? '');
      this.folderNameErr.set(null);
    }
  }

  get isEmpty(): boolean {
    return this.folders.length === 0 && this.documents.length === 0;
  }

  isBusy(id: string): boolean {
    return this.busyIds.has(id);
  }

  // ---------- Subida ----------

  onFilePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.upload.emit(Array.from(input.files));
      input.value = '';
    }
  }

  onDragOver(event: DragEvent): void {
    if (!this.caps.canUpload) {
      return;
    }
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    if (!this.caps.canUpload) {
      return;
    }
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.upload.emit(Array.from(files));
    }
  }

  // ---------- Borrado ----------

  requestDelete(doc: ClientDocumentItem): void {
    this.pendingDelete.set(doc);
  }

  confirmDelete(): void {
    const doc = this.pendingDelete();
    if (doc) {
      this.remove.emit(doc);
    }
    this.pendingDelete.set(null);
  }

  // ---------- Diálogo de carpeta ----------

  submitFolder(): void {
    const error = folderNameError(this.folderName());
    this.folderNameErr.set(error);
    if (!error && !this.savingFolder) {
      this.submitFolderName.emit(this.folderName().trim());
    }
  }

  // ---------- Presentación ----------

  /** Todo archivo listo se abre en el visor (PDF, imagen, texto y CSV se pintan; el resto ofrece descargar). */
  canPreview(doc: ClientDocumentItem): boolean {
    return doc.isReady;
  }

  statusChipClass(status: ClientDocumentItem['status']): string {
    switch (status) {
      case 'ready':
        return 'border-emerald-200 bg-emerald-50 text-emerald-600';
      case 'processing':
      case 'uploading':
        return 'border-amber-200 bg-amber-50 text-amber-600';
      case 'blocked':
        return 'border-red-200 bg-red-50 text-red-500';
    }
  }

  statusLabel(status: ClientDocumentItem['status']): string {
    switch (status) {
      case 'ready':
        return 'Ready';
      case 'processing':
        return 'Scanning…';
      case 'uploading':
        return 'Uploading…';
      case 'blocked':
        return 'Blocked';
    }
  }

  iconTint(kind: ClientDocumentItem['kind']): string {
    switch (kind) {
      case 'xlsx':
        return 'bg-emerald-50 text-emerald-600';
      case 'img':
        return 'bg-indigo-50 text-indigo-500';
      case 'doc':
        return 'bg-sky-50 text-sky-600';
      case 'pdf':
      default:
        return 'bg-red-50 text-red-500';
    }
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }
}
