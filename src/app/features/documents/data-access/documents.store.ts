import { Injectable, computed, inject, signal } from '@angular/core';
import { map, of, switchMap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { InitiateUploadRequest, isFilePending } from '@core/cloud-storage/cloud-storage.model';
import { DocumentsClientSummary, DocumentsClientsService } from './documents-clients.service';
import { DocumentsService } from './documents.service';
import { FileResponse, FolderResponse, RecycleBinItemResponse } from './documents.model';

/** Cuántas veces se re-consulta el estado de un archivo recién subido antes de dejar de pollear. */
const MAX_STATUS_POLLS = 8;
const STATUS_POLL_INTERVAL_MS = 3000;

/**
 * Store del módulo Documents (CloudStorage.Api vía /storage + Customer.Api vía /customers
 * para el picker). providedIn: 'root' — una sola instancia para toda la ruta del módulo.
 */
@Injectable({ providedIn: 'root' })
export class DocumentsStore {
  private readonly clientsService = inject(DocumentsClientsService);
  private readonly service = inject(DocumentsService);
  private readonly cloudStorage = inject(CloudStorageUploadService);

  // ---------- Picker de clientes ----------
  private readonly _clients = signal<DocumentsClientSummary[]>([]);
  private readonly _clientSearch = signal('');
  private readonly _clientsLoading = signal(false);
  private readonly _clientsError = signal<string | null>(null);

  readonly clients = this._clients.asReadonly();
  readonly clientSearch = this._clientSearch.asReadonly();
  readonly clientsLoading = this._clientsLoading.asReadonly();
  readonly clientsError = this._clientsError.asReadonly();

  // ---------- Cliente seleccionado + navegación de carpetas ----------
  private readonly _selectedClient = signal<DocumentsClientSummary | null>(null);
  private readonly _breadcrumbs = signal<FolderResponse[]>([]);
  private readonly _subfolders = signal<FolderResponse[]>([]);
  private readonly _files = signal<FileResponse[]>([]);
  private readonly _folderLoading = signal(false);
  private readonly _folderError = signal<string | null>(null);
  private readonly _uploadingCount = signal(0);

  readonly selectedClient = this._selectedClient.asReadonly();
  readonly breadcrumbs = this._breadcrumbs.asReadonly();
  readonly subfolders = this._subfolders.asReadonly();
  readonly files = this._files.asReadonly();
  readonly folderLoading = this._folderLoading.asReadonly();
  readonly folderError = this._folderError.asReadonly();
  readonly uploading = computed(() => this._uploadingCount() > 0);

  readonly currentFolderId = computed<string | null>(() => {
    const crumbs = this._breadcrumbs();
    return crumbs.length > 0 ? crumbs[crumbs.length - 1].id : null;
  });

  // ---------- Papelera ----------
  private readonly _recycleBinItems = signal<RecycleBinItemResponse[]>([]);
  private readonly _recycleBinLoading = signal(false);
  private readonly _recycleBinError = signal<string | null>(null);

  readonly recycleBinItems = this._recycleBinItems.asReadonly();
  readonly recycleBinLoading = this._recycleBinLoading.asReadonly();
  readonly recycleBinError = this._recycleBinError.asReadonly();

  // ---------- Picker ----------

  setClientSearch(term: string): void {
    this._clientSearch.set(term);
    this.refreshClients();
  }

  refreshClients(): void {
    this._clientsLoading.set(true);
    this._clientsError.set(null);
    this.clientsService.search(this._clientSearch()).subscribe({
      next: result => {
        this._clients.set(result.items);
        this._clientsLoading.set(false);
      },
      error: err => {
        this._clientsError.set(toApiError(err).message);
        this._clientsLoading.set(false);
      },
    });
  }

  // ---------- Navegación ----------

  selectClient(client: DocumentsClientSummary): void {
    this._selectedClient.set(client);
    this._breadcrumbs.set([]);
    this.loadCurrentFolder();
  }

  clearSelectedClient(): void {
    this._selectedClient.set(null);
    this._breadcrumbs.set([]);
    this._subfolders.set([]);
    this._files.set([]);
  }

  loadCurrentFolder(): void {
    const client = this._selectedClient();
    if (!client) {
      return;
    }
    this._folderLoading.set(true);
    this._folderError.set(null);
    this.service.getFolderContents(client.id, this.currentFolderId()).subscribe({
      next: contents => {
        this._subfolders.set(contents.subfolders);
        this._files.set(contents.files);
        this._folderLoading.set(false);
      },
      error: err => {
        this._folderError.set(toApiError(err).message);
        this._folderLoading.set(false);
      },
    });
  }

  openFolder(folder: FolderResponse): void {
    this._breadcrumbs.update(crumbs => [...crumbs, folder]);
    this.loadCurrentFolder();
  }

  goToRoot(): void {
    this._breadcrumbs.set([]);
    this.loadCurrentFolder();
  }

  goToBreadcrumb(folder: FolderResponse): void {
    this._breadcrumbs.update(crumbs => {
      const index = crumbs.findIndex(c => c.id === folder.id);
      return index === -1 ? crumbs : crumbs.slice(0, index + 1);
    });
    this.loadCurrentFolder();
  }

  // ---------- Carpetas ----------

  createFolder(name: string): void {
    const client = this._selectedClient();
    const trimmed = name.trim();
    if (!client || !trimmed) {
      return;
    }
    this.service
      .createFolder({
        parentFolderId: this.currentFolderId(),
        name: trimmed,
        ownerType: 'Customer',
        ownerId: client.id,
        category: null,
      })
      .subscribe({
        next: () => this.loadCurrentFolder(),
        error: err => this._folderError.set(toApiError(err).message),
      });
  }

  // ---------- Archivos ----------

  uploadFiles(fileList: FileList | File[]): void {
    const client = this._selectedClient();
    if (!client) {
      return;
    }
    Array.from(fileList).forEach(file => this.uploadOne(client.id, file));
  }

  private uploadOne(ownerId: string, file: File): void {
    const folderId = this.currentFolderId();
    const request: InitiateUploadRequest = {
      originalName: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      ownerType: 'Customer',
      ownerId,
      folderType: 'Documents',
      taxYear: new Date().getFullYear(),
    };

    this._uploadingCount.update(n => n + 1);
    this.cloudStorage
      .initiateUpload(request)
      .pipe(
        switchMap(initiated =>
          this.cloudStorage.uploadToPresignedUrl(initiated.uploadUrl, initiated.formData, file).pipe(
            switchMap(() => this.cloudStorage.completeUpload(initiated.fileId)),
            switchMap(() =>
              folderId ? this.service.moveFileToFolder(initiated.fileId, folderId) : of(undefined),
            ),
            map(() => initiated.fileId),
          ),
        ),
      )
      .subscribe({
        next: fileId => {
          this._uploadingCount.update(n => n - 1);
          this.loadCurrentFolder();
          this.pollFileStatus(fileId, MAX_STATUS_POLLS);
        },
        error: err => {
          this._uploadingCount.update(n => n - 1);
          this._folderError.set(toApiError(err).message);
        },
      });
  }

  private pollFileStatus(fileId: string, attemptsLeft: number): void {
    if (attemptsLeft <= 0) {
      return;
    }
    setTimeout(() => {
      this.cloudStorage.getFile(fileId).subscribe({
        next: file => {
          this._files.update(list => list.map(f => (f.id === file.id ? file : f)));
          if (isFilePending(file.status)) {
            this.pollFileStatus(fileId, attemptsLeft - 1);
          }
        },
        error: () => {
          // El polling es best-effort: si falla una consulta, se deja de intentar en silencio.
        },
      });
    }, STATUS_POLL_INTERVAL_MS);
  }

  deleteFile(fileId: string): void {
    this.service.deleteFile(fileId).subscribe({
      next: () => this._files.update(list => list.filter(f => f.id !== fileId)),
      error: err => this._folderError.set(toApiError(err).message),
    });
  }

  downloadFile(fileId: string): void {
    this.cloudStorage.getDownloadUrl(fileId).subscribe({
      next: res => window.open(res.downloadUrl, '_blank'),
      error: err => this._folderError.set(toApiError(err).message),
    });
  }

  // ---------- Papelera ----------

  loadRecycleBin(): void {
    this._recycleBinLoading.set(true);
    this._recycleBinError.set(null);
    this.service.listRecycleBin().subscribe({
      next: items => {
        this._recycleBinItems.set(items);
        this._recycleBinLoading.set(false);
      },
      error: err => {
        this._recycleBinError.set(toApiError(err).message);
        this._recycleBinLoading.set(false);
      },
    });
  }

  restoreFile(fileId: string): void {
    this.service.restoreFile(fileId).subscribe({
      next: () => this._recycleBinItems.update(list => list.filter(i => i.id !== fileId)),
      error: err => this._recycleBinError.set(toApiError(err).message),
    });
  }

  emptyRecycleBin(): void {
    this.service.emptyRecycleBin().subscribe({
      next: () => this._recycleBinItems.set([]),
      error: err => this._recycleBinError.set(toApiError(err).message),
    });
  }
}
