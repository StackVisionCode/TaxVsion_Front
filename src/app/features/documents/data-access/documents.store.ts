import { Injectable, computed, inject, signal } from '@angular/core';
import { map, of, switchMap } from 'rxjs';
import { toUserMessage } from '@core/errors/error-messages';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { InitiateUploadRequest, OwnerType, isFilePending } from '@core/cloud-storage/cloud-storage.model';
import { DocumentsClientSummary, DocumentsClientsService } from './documents-clients.service';
import { DocumentsService } from './documents.service';
import {
  CreateShareLinkRequest,
  CreatedShareLinkResponse,
  DocumentSort,
  FileFilters,
  FileResponse,
  FolderResponse,
  FolderTreeNode,
  RecycleBinItemResponse,
  ShareLinkResponse,
  StorageUsageResponse,
  ViewMode,
  WorkspaceContext,
  WorkspaceSection,
  displayStatus,
  emptyFilters,
  isUserFacingFolderType,
} from './documents.model';

/** Cuántas veces se re-consulta el estado de un archivo recién subido antes de dejar de pollear. */
const MAX_STATUS_POLLS = 8;
const STATUS_POLL_INTERVAL_MS = 3000;

/**
 * Store del gestor documental (workspace de toda la oficina). Un solo contexto activo
 * (`office` = archivos del tenant, o `client` = los de un customer), navegación por carpetas,
 * y auto-refresh tras cada acción (crear/renombrar/mover/borrar/subir) — el usuario nunca
 * recarga la página. Todo error se muestra como texto limpio vía ToastService (`toUserMessage`,
 * nunca el error crudo del backend). providedIn: 'root' — una instancia por ruta del módulo.
 */
@Injectable({ providedIn: 'root' })
export class DocumentsStore {
  private readonly clientsService = inject(DocumentsClientsService);
  private readonly service = inject(DocumentsService);
  private readonly cloudStorage = inject(CloudStorageUploadService);
  private readonly toast = inject(ToastService);

  // ---------- Contexto del workspace ----------
  private readonly _context = signal<WorkspaceContext>({ section: 'office', clientId: null, clientName: null });
  readonly context = this._context.asReadonly();
  readonly section = computed<WorkspaceSection>(() => this._context().section);
  /** Se navega por carpetas (office/client) solo en esas dos secciones. */
  readonly isBrowsing = computed(() => this._context().section === 'office' || this._context().section === 'client');

  // ---------- Lista de clientes (dentro del navegador) ----------
  private readonly _clients = signal<DocumentsClientSummary[]>([]);
  private readonly _clientsTotal = signal(0);
  private readonly _clientSearch = signal('');
  private readonly _clientsLoading = signal(false);

  readonly clients = this._clients.asReadonly();
  readonly clientsTotal = this._clientsTotal.asReadonly();
  readonly clientSearch = this._clientSearch.asReadonly();
  readonly clientsLoading = this._clientsLoading.asReadonly();

  // ---------- Navegación de carpetas ----------
  private readonly _breadcrumbs = signal<FolderResponse[]>([]);
  private readonly _subfolders = signal<FolderResponse[]>([]);
  private readonly _files = signal<FileResponse[]>([]);
  private readonly _folderLoading = signal(false);
  private readonly _uploadingCount = signal(0);

  readonly breadcrumbs = this._breadcrumbs.asReadonly();
  readonly subfolders = this._subfolders.asReadonly();
  readonly files = this._files.asReadonly();
  readonly folderLoading = this._folderLoading.asReadonly();
  readonly uploading = computed(() => this._uploadingCount() > 0);

  readonly currentFolderId = computed<string | null>(() => {
    const crumbs = this._breadcrumbs();
    return crumbs.length > 0 ? crumbs[crumbs.length - 1].id : null;
  });

  // ---------- Vista / filtros / orden ----------
  private readonly _viewMode = signal<ViewMode>('list');
  private readonly _sort = signal<DocumentSort>({ key: 'name', dir: 'asc' });
  private readonly _filters = signal<FileFilters>(emptyFilters());
  readonly viewMode = this._viewMode.asReadonly();
  readonly sort = this._sort.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly activeFilterCount = computed(() => {
    const f = this._filters();
    return f.years.length + f.types.length + f.statuses.length;
  });

  /**
   * Archivos visibles en el explorador: oculta el ruido interno (FolderType no navegable, ej.
   * Branding/Templates que quedan en raíz), aplica filtros y orden. La UI bindea ESTO, no `files`.
   */
  readonly visibleFiles = computed<FileResponse[]>(() => {
    const f = this._filters();
    const sort = this._sort();
    let out = this._files().filter(file => isUserFacingFolderType(file.folderType));
    if (f.years.length) {
      out = out.filter(file => file.taxYear !== null && f.years.includes(file.taxYear));
    }
    if (f.types.length) {
      out = out.filter(file => f.types.includes((file.originalName.split('.').pop() ?? '').toUpperCase()));
    }
    if (f.statuses.length) {
      out = out.filter(file => f.statuses.includes(displayStatus(file.status)));
    }
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (file: FileResponse) =>
      sort.key === 'size' ? file.sizeBytes : sort.key === 'modified' ? (file.scannedAtUtc ?? file.createdAtUtc) : file.originalName.toLowerCase();
    return [...out].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return x < y ? -dir : x > y ? dir : 0;
    });
  });

  // ---------- Multiselección + barra en lote ----------
  private readonly _selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly selectedIds = this._selectedIds.asReadonly();
  /** Solo cuentan los seleccionados que están en la carpeta actual (evita selección fantasma al navegar). */
  readonly selectedFiles = computed<FileResponse[]>(() => {
    const ids = this._selectedIds();
    return this._files().filter(file => ids.has(file.id));
  });
  readonly selectionCount = computed(() => this.selectedFiles().length);
  readonly hasSelection = computed(() => this.selectedFiles().length > 0);

  // ---------- Selección para el panel de detalles ----------
  private readonly _selectedFileId = signal<string | null>(null);
  readonly selectedFileId = this._selectedFileId.asReadonly();
  /** El archivo seleccionado, siempre derivado de la lista viva (se refresca con el poll). */
  readonly selectedFile = computed<FileResponse | null>(() => {
    const id = this._selectedFileId();
    return id ? (this._files().find(f => f.id === id) ?? null) : null;
  });

  // ---------- Compartir + Shared with Me ----------
  private readonly _createdShare = signal<CreatedShareLinkResponse | null>(null);
  readonly createdShare = this._createdShare.asReadonly();
  private readonly _sharedWithMe = signal<ShareLinkResponse[]>([]);
  private readonly _sharedLoading = signal(false);
  readonly sharedWithMe = this._sharedWithMe.asReadonly();
  readonly sharedLoading = this._sharedLoading.asReadonly();

  // ---------- Árbol para "mover" ----------
  private readonly _folderTree = signal<FolderTreeNode[]>([]);
  readonly folderTree = this._folderTree.asReadonly();

  // ---------- Papelera ----------
  private readonly _recycleBinItems = signal<RecycleBinItemResponse[]>([]);
  private readonly _recycleBinLoading = signal(false);
  readonly recycleBinItems = this._recycleBinItems.asReadonly();
  readonly recycleBinLoading = this._recycleBinLoading.asReadonly();

  // ---------- Almacenamiento ----------
  private readonly _usage = signal<StorageUsageResponse | null>(null);
  readonly usage = this._usage.asReadonly();

  // ---------- Recientes ----------
  private readonly _recent = signal<FileResponse[]>([]);
  private readonly _recentLoading = signal(false);
  readonly recent = this._recent.asReadonly();
  readonly recentLoading = this._recentLoading.asReadonly();

  // ================= Dueño del contexto activo =================

  private ownerType(): OwnerType {
    return this._context().section === 'client' ? 'Customer' : 'Tenant';
  }

  private ownerId(): string | null {
    return this._context().section === 'client' ? this._context().clientId : null;
  }

  // ================= Clientes =================

  setClientSearch(term: string): void {
    this._clientSearch.set(term);
    this.refreshClients();
  }

  refreshClients(): void {
    this._clientsLoading.set(true);
    this.clientsService.search(this._clientSearch()).subscribe({
      next: result => {
        this._clients.set(result.items);
        this._clientsTotal.set(result.totalCount);
        this._clientsLoading.set(false);
      },
      error: err => {
        this._clientsLoading.set(false);
        this.toast.error(toUserMessage(err));
      },
    });
  }

  // ================= Cambio de contexto =================

  openOffice(): void {
    this.setContext({ section: 'office', clientId: null, clientName: null });
  }

  openClient(client: DocumentsClientSummary): void {
    this.setContext({ section: 'client', clientId: client.id, clientName: client.displayName });
  }

  openRecycleBin(): void {
    this._context.set({ section: 'trash', clientId: null, clientName: null });
    this.clearNavigation();
    this.loadRecycleBin();
  }

  openRecent(): void {
    this._context.set({ section: 'recent', clientId: null, clientName: null });
    this.clearNavigation();
    this.loadRecent();
  }

  openSharedWithMe(): void {
    this._context.set({ section: 'shared', clientId: null, clientName: null });
    this.clearNavigation();
    this.loadSharedWithMe();
  }

  private setContext(context: WorkspaceContext): void {
    this._context.set(context);
    this.clearNavigation();
    this.loadCurrentFolder();
  }

  private clearNavigation(): void {
    this._breadcrumbs.set([]);
    this._subfolders.set([]);
    this._files.set([]);
    this._selectedFileId.set(null);
    this._selectedIds.set(new Set());
    this._filters.set(emptyFilters());
  }

  // ================= Navegación =================

  loadCurrentFolder(): void {
    if (!this.isBrowsing()) {
      return;
    }
    this._folderLoading.set(true);
    this.service.getFolderContents(this.ownerType(), this.ownerId(), this.currentFolderId()).subscribe({
      next: contents => {
        this._subfolders.set(contents.subfolders);
        this._files.set(contents.files);
        this._folderLoading.set(false);
      },
      error: err => {
        this._folderLoading.set(false);
        this.toast.error(toUserMessage(err));
      },
    });
  }

  openFolder(folder: FolderResponse): void {
    this._breadcrumbs.update(crumbs => [...crumbs, folder]);
    this._selectedFileId.set(null);
    this.loadCurrentFolder();
  }

  goToRoot(): void {
    this._breadcrumbs.set([]);
    this._selectedFileId.set(null);
    this.loadCurrentFolder();
  }

  goToBreadcrumb(folder: FolderResponse): void {
    this._breadcrumbs.update(crumbs => {
      const index = crumbs.findIndex(c => c.id === folder.id);
      return index === -1 ? crumbs : crumbs.slice(0, index + 1);
    });
    this._selectedFileId.set(null);
    this.loadCurrentFolder();
  }

  // ================= Carpetas =================

  createFolder(name: string): void {
    const trimmed = name.trim();
    if (!trimmed || !this.isBrowsing()) {
      return;
    }
    this.service
      .createFolder({
        parentFolderId: this.currentFolderId(),
        name: trimmed,
        ownerType: this.ownerType(),
        ownerId: this.ownerId() ?? '',
        category: null,
      })
      .subscribe({
        next: () => {
          this.toast.success(`Folder "${trimmed}" created`);
          this.loadCurrentFolder();
        },
        error: err => this.toast.error(toUserMessage(err)),
      });
  }

  renameFolder(folder: FolderResponse, newName: string): void {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === folder.name) {
      return;
    }
    this.service.renameFolder(folder.id, trimmed).subscribe({
      next: () => {
        this.toast.success(`Renamed to "${trimmed}"`);
        this.loadCurrentFolder();
      },
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  moveFolder(folder: FolderResponse, targetFolderId: string | null): void {
    this.service.moveFolder(folder.id, targetFolderId).subscribe({
      next: () => {
        this.toast.success(`Moved "${folder.name}"`);
        this.loadCurrentFolder();
      },
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  deleteFolder(folder: FolderResponse): void {
    this.service.deleteFolder(folder.id).subscribe({
      next: () => {
        this.toast.success(`Deleted "${folder.name}"`);
        this.loadCurrentFolder();
      },
      // Folder.NotEmpty → "This folder must be empty before it can be deleted." (catálogo).
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  loadFolderTree(): void {
    if (!this.isBrowsing()) {
      return;
    }
    this.service.getFolderTree(this.ownerType(), this.ownerId()).subscribe({
      next: tree => this._folderTree.set(tree),
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  // ================= Archivos =================

  uploadFiles(fileList: FileList | File[]): void {
    if (!this.isBrowsing()) {
      return;
    }
    const files = Array.from(fileList);
    if (files.length === 0) {
      return;
    }
    this.toast.info(files.length === 1 ? 'Uploading 1 file' : `Uploading ${files.length} files`);
    files.forEach(file => this.uploadOne(file));
  }

  private uploadOne(file: File): void {
    const folderId = this.currentFolderId();
    const request: InitiateUploadRequest = {
      originalName: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      ownerType: this.ownerType(),
      ownerId: this.ownerId() ?? '',
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
          this.toast.error(toUserMessage(err));
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
          } else if (file.status === 'Available') {
            this.toast.success(`${file.originalName} is ready`);
          }
        },
        error: () => {
          // Best-effort: si una consulta de poll falla, se deja de intentar en silencio.
        },
      });
    }, STATUS_POLL_INTERVAL_MS);
  }

  moveFile(fileId: string, targetFolderId: string | null): void {
    const file = this._files().find(f => f.id === fileId);
    this.service.moveFileToFolder(fileId, targetFolderId).subscribe({
      next: () => {
        this.toast.success(file ? `Moved "${file.originalName}"` : 'File moved');
        this.loadCurrentFolder();
      },
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  deleteFile(fileId: string): void {
    const file = this._files().find(f => f.id === fileId);
    this.service.deleteFile(fileId).subscribe({
      next: () => {
        this._files.update(list => list.filter(f => f.id !== fileId));
        if (this._selectedFileId() === fileId) {
          this._selectedFileId.set(null);
        }
        this.toast.success(file ? `Moved "${file.originalName}" to the recycle bin` : 'Moved to the recycle bin');
      },
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  downloadFile(file: FileResponse): void {
    this.cloudStorage.getDownloadUrl(file.id).subscribe({
      // El download-url se presigna con content-disposition=attachment: un ancla oculto baja
      // directo, sin abrir pestaña ni exponer la URL de MinIO.
      next: res => this.triggerDownload(res.downloadUrl),
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  private triggerDownload(url: string, filename = ''): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  // ================= Selección =================

  selectFile(file: FileResponse): void {
    this._selectedFileId.set(file.id);
  }

  clearSelection(): void {
    this._selectedFileId.set(null);
  }

  // ================= Papelera =================

  loadRecycleBin(): void {
    this._recycleBinLoading.set(true);
    this.service.listRecycleBin().subscribe({
      next: items => {
        this._recycleBinItems.set(items);
        this._recycleBinLoading.set(false);
      },
      error: err => {
        this._recycleBinLoading.set(false);
        this.toast.error(toUserMessage(err));
      },
    });
  }

  restoreFile(item: RecycleBinItemResponse): void {
    this.service.restoreFile(item.id).subscribe({
      next: () => {
        this._recycleBinItems.update(list => list.filter(i => i.id !== item.id));
        this.toast.success(`Restored "${item.originalName}"`);
      },
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  emptyRecycleBin(): void {
    this.service.emptyRecycleBin().subscribe({
      next: result => {
        this._recycleBinItems.set([]);
        this.toast.success(
          result.purgedCount === 1
            ? '1 item permanently removed'
            : `${result.purgedCount} items permanently removed`,
        );
      },
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  // ================= Recientes =================

  loadRecent(): void {
    this._recentLoading.set(true);
    // Listado plano del tenant (staff), más recientes primero (el backend ya ordena por fecha).
    this.cloudStorage.listFiles(0, 25).subscribe({
      next: files => {
        this._recent.set(files);
        this._recentLoading.set(false);
      },
      error: err => {
        this._recentLoading.set(false);
        this.toast.error(toUserMessage(err));
      },
    });
  }

  // ================= Vista / orden / filtros =================

  setViewMode(mode: ViewMode): void {
    this._viewMode.set(mode);
  }

  setSort(key: DocumentSort['key']): void {
    this._sort.update(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  }

  toggleFilter(group: keyof FileFilters, value: string | number): void {
    this._filters.update(f => {
      const list = f[group] as (string | number)[];
      const next = list.includes(value) ? list.filter(x => x !== value) : [...list, value];
      return { ...f, [group]: next };
    });
  }

  clearFilters(): void {
    this._filters.set(emptyFilters());
  }

  // ================= Multiselección + lote =================

  toggleFileSelection(fileId: string): void {
    this._selectedIds.update(ids => {
      const next = new Set(ids);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }

  toggleSelectAll(): void {
    const visible = this.visibleFiles();
    this._selectedIds.update(ids => {
      const allSelected = visible.length > 0 && visible.every(f => ids.has(f.id));
      if (allSelected) {
        const next = new Set(ids);
        visible.forEach(f => next.delete(f.id));
        return next;
      }
      const next = new Set(ids);
      visible.forEach(f => next.add(f.id));
      return next;
    });
  }

  clearFileSelection(): void {
    this._selectedIds.set(new Set());
  }

  deleteSelected(): void {
    const selected = this.selectedFiles();
    if (selected.length === 0) {
      return;
    }
    // Borra en serie; refresca al final.
    let remaining = selected.length;
    selected.forEach(file => {
      this.service.deleteFile(file.id).subscribe({
        next: () => {
          remaining -= 1;
          if (remaining === 0) {
            this.clearFileSelection();
            this.loadCurrentFolder();
            this.toast.success(`Moved ${selected.length} ${selected.length === 1 ? 'item' : 'items'} to the recycle bin`);
          }
        },
        error: err => this.toast.error(toUserMessage(err)),
      });
    });
  }

  moveSelected(targetFolderId: string | null): void {
    const selected = this.selectedFiles();
    if (selected.length === 0) {
      return;
    }
    let remaining = selected.length;
    selected.forEach(file => {
      this.service.moveFileToFolder(file.id, targetFolderId).subscribe({
        next: () => {
          remaining -= 1;
          if (remaining === 0) {
            this.clearFileSelection();
            this.loadCurrentFolder();
            this.toast.success(`Moved ${selected.length} ${selected.length === 1 ? 'item' : 'items'}`);
          }
        },
        error: err => this.toast.error(toUserMessage(err)),
      });
    });
  }

  downloadSelected(): void {
    const ready = this.selectedFiles().filter(f => f.status === 'Available');
    if (ready.length === 0) {
      this.toast.error('None of the selected files are ready to download.');
      return;
    }
    if (ready.length === 1) {
      this.downloadFile(ready[0]);
      return;
    }
    this.toast.info(`Preparing ${ready.length} files as a ZIP`);
    this.service.downloadZip(ready.map(f => f.id)).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        this.triggerDownload(url, 'taxvision-export.zip');
        URL.revokeObjectURL(url);
      },
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  // ================= Compartir =================

  createShareLink(file: FileResponse, req: CreateShareLinkRequest): void {
    this.service.createShareLink(file.id, req).subscribe({
      next: created => this._createdShare.set(created),
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  clearCreatedShare(): void {
    this._createdShare.set(null);
  }

  loadSharedWithMe(): void {
    this._sharedLoading.set(true);
    this.service.listSharedWithMe().subscribe({
      next: items => {
        this._sharedWithMe.set(items);
        this._sharedLoading.set(false);
      },
      error: err => {
        this._sharedLoading.set(false);
        this.toast.error(toUserMessage(err));
      },
    });
  }

  // ================= Almacenamiento =================

  loadUsage(): void {
    this.service.getUsage().subscribe({
      next: usage => this._usage.set(usage),
      error: () => {
        // El uso es informativo; si falla no molestamos con un toast.
      },
    });
  }
}
