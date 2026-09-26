import { Injectable, computed, inject, signal } from '@angular/core';
import { map, of, switchMap, Observable } from 'rxjs';
import { toUserMessage } from '@core/errors/error-messages';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { InitiateUploadRequest, OwnerType, isFilePending } from '@core/cloud-storage/cloud-storage.model';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { CustomerStatusFilter, CustomerSummary } from '@core/customers/customer-summary.model';
import { DocumentsService } from './documents.service';
import {
  CreateShareLinkRequest,
  CreateFolderShareLinkRequest,
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
  FolderContentsQueryOpts,
  emptyFilters,
  USER_FACING_FOLDER_TYPES,
  displayStatusToFileStatuses,
} from './documents.model';

/** Filas por página del selector de clientes. Cabe en pantalla sin scroll interno. */
const CLIENTS_PAGE_SIZE = 12;
/** Espera antes de buscar clientes: la búsqueda es del servidor, no se lanza por tecla. */
const CLIENT_SEARCH_DEBOUNCE_MS = 300;
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
  private readonly directory = inject(CustomerDirectoryStore);
  private readonly service = inject(DocumentsService);
  private readonly cloudStorage = inject(CloudStorageUploadService);
  private readonly toast = inject(ToastService);

  // ---------- Contexto del workspace ----------
  private readonly _context = signal<WorkspaceContext>({ section: 'office', clientId: null, clientName: null });
  readonly context = this._context.asReadonly();
  readonly section = computed<WorkspaceSection>(() => this._context().section);
  /** Se navega por carpetas (office/client) solo en esas dos secciones. */
  readonly isBrowsing = computed(() => this._context().section === 'office' || this._context().section === 'client');

  // ---------- Selector de clientes (pantalla propia, paginado server-side) ----------
  private readonly _clients = signal<CustomerSummary[]>([]);
  private readonly _clientsTotal = signal(0);
  private readonly _clientSearch = signal('');
  private readonly _clientsLoading = signal(false);
  private readonly _clientsPage = signal(1);
  private readonly _clientsStatus = signal<CustomerStatusFilter>('NotArchived');
  private clientSearchDebounce: ReturnType<typeof setTimeout> | null = null;

  readonly clients = this._clients.asReadonly();
  readonly clientsTotal = this._clientsTotal.asReadonly();
  readonly clientSearch = this._clientSearch.asReadonly();
  readonly clientsLoading = this._clientsLoading.asReadonly();
  readonly clientsPage = this._clientsPage.asReadonly();
  readonly clientsStatus = this._clientsStatus.asReadonly();

  readonly clientsPageCount = computed(() =>
    Math.max(1, Math.ceil(this._clientsTotal() / CLIENTS_PAGE_SIZE)),
  );
  /** Hay algo que la búsqueda o el filtro están escondiendo. */
  readonly clientsFiltered = computed(
    () => this._clientSearch().trim().length > 0 || this._clientsStatus() !== 'NotArchived',
  );

  // ---------- Navegación de carpetas ----------
  private readonly _breadcrumbs = signal<FolderResponse[]>([]);
  private readonly _subfolders = signal<FolderResponse[]>([]);
  private readonly _files = signal<FileResponse[]>([]);
  private readonly _folderLoading = signal(false);
  private readonly _uploadingCount = signal(0);

  // Paginación server-side (carpetas primero). El backend acota take a 200; acá usamos 50.
  private readonly _page = signal(0);
  private readonly _totalCount = signal(0);
  readonly pageSize = 25;

  readonly breadcrumbs = this._breadcrumbs.asReadonly();
  readonly subfolders = this._subfolders.asReadonly();
  readonly files = this._files.asReadonly();
  readonly folderLoading = this._folderLoading.asReadonly();
  readonly uploading = computed(() => this._uploadingCount() > 0);

  // Estado de paginación expuesto a la UI (1-based para mostrar).
  readonly page = computed(() => this._page() + 1);
  readonly totalCount = this._totalCount.asReadonly();
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this._totalCount() / this.pageSize)));
  readonly hasPrevPage = computed(() => this._page() > 0);
  readonly hasNextPage = computed(() => this._page() + 1 < this.pageCount());
  /** Índice 1-based del primer y último item de la página actual (para "X–Y de N"). */
  readonly pageStart = computed(() => (this._totalCount() === 0 ? 0 : this._page() * this.pageSize + 1));
  readonly pageEnd = computed(() =>
    Math.min(this._totalCount(), this._page() * this.pageSize + this._subfolders().length + this._files().length)
  );

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
   * Archivos visibles en el explorador. El filtrado (tipo user-facing, año, extensión, estado) y el
   * orden ahora los hace el BACKEND (ver buildQueryOpts), así que esto es la página tal cual llega.
   * Se mantiene el nombre porque la UI bindea `visibleFiles`.
   */
  readonly visibleFiles = this._files.asReadonly();

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
  /** Links creados sobre el archivo seleccionado (gestión: ver/revocar). */
  private readonly _fileShares = signal<ShareLinkResponse[]>([]);
  private readonly _fileSharesLoading = signal(false);
  private readonly _fileSharesFileId = signal<string | null>(null);
  readonly fileShares = this._fileShares.asReadonly();
  readonly fileSharesLoading = this._fileSharesLoading.asReadonly();

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

  /**
   * Buscar o cambiar de filtro vuelve SIEMPRE a la página 1: si no, se busca algo y se
   * aterriza en una página que ya no existe para ese resultado, y parece que no hay nada.
   *
   * La búsqueda va con retardo porque es server-side: sin él, escribir "Enger" son cinco
   * peticiones y la última en salir no tiene por qué ser la última en volver.
   */
  setClientSearch(term: string): void {
    this._clientSearch.set(term);
    this._clientsPage.set(1);
    if (this.clientSearchDebounce !== null) {
      clearTimeout(this.clientSearchDebounce);
    }
    this.clientSearchDebounce = setTimeout(() => {
      this.clientSearchDebounce = null;
      this.refreshClients();
    }, CLIENT_SEARCH_DEBOUNCE_MS);
  }

  setClientsStatus(status: CustomerStatusFilter): void {
    this._clientsStatus.set(status);
    this._clientsPage.set(1);
    this.refreshClientsNow();
  }

  setClientsPage(page: number): void {
    const clamped = Math.min(Math.max(1, page), this.clientsPageCount());
    if (clamped === this._clientsPage()) {
      return;
    }
    this._clientsPage.set(clamped);
    this.refreshClientsNow();
  }

  clearClientFilters(): void {
    this._clientSearch.set('');
    this._clientsStatus.set('NotArchived');
    this._clientsPage.set(1);
    this.refreshClientsNow();
  }

  /** Recarga inmediata: cancela un debounce de búsqueda pendiente para no pisar el resultado. */
  private refreshClientsNow(): void {
    if (this.clientSearchDebounce !== null) {
      clearTimeout(this.clientSearchDebounce);
      this.clientSearchDebounce = null;
    }
    this.refreshClients();
  }

  refreshClients(): void {
    this._clientsLoading.set(true);
    this.directory
      .search({
        term: this._clientSearch(),
        status: this._clientsStatus(),
        page: this._clientsPage(),
        size: CLIENTS_PAGE_SIZE,
      })
      .subscribe({
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

  /**
   * Abre el SELECTOR de clientes a pantalla completa. Conserva el cliente activo en el
   * contexto para que volver atrás sin elegir a nadie no pierda dónde estabas.
   */
  openClients(): void {
    const current = this._context();
    this._context.set({ ...current, section: 'clients' });
    this.clearNavigation();
    this.refreshClients();
  }

  openClient(client: CustomerSummary): void {
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
    this._page.set(0);
    this._totalCount.set(0);
  }

  // ================= Navegación =================

  /**
   * Re-lee la carpeta actual en silencio (sin skeleton) para refrescar el badge "Shared" de cada
   * item tras crear/revocar un link. Un archivo puede tener varios links, así que se re-consulta al
   * backend (recalcula isShared) en vez de adivinar en el cliente.
   */
  /** Arma paginación + filtro + orden server-side para la carpeta actual. */
  private buildQueryOpts(): FolderContentsQueryOpts {
    const f = this._filters();
    const sort = this._sort();
    return {
      skip: this._page() * this.pageSize,
      take: this.pageSize,
      // El explorador siempre oculta los FolderType internos (Branding/Avatars/Templates…).
      folderTypes: [...USER_FACING_FOLDER_TYPES],
      taxYears: f.years,
      extensions: f.types,
      statuses: f.statuses.flatMap(displayStatusToFileStatuses),
      sort: sort.key === 'modified' ? 'Modified' : sort.key === 'size' ? 'Size' : 'Name',
      desc: sort.dir === 'desc',
    };
  }

  private refreshShareBadges(): void {
    if (!this.isBrowsing()) {
      return;
    }
    this.service
      .getFolderContents(this.ownerType(), this.ownerId(), this.currentFolderId(), this.buildQueryOpts())
      .subscribe({
        next: contents => {
          this._subfolders.set(contents.subfolders);
          this._files.set(contents.files);
          this._totalCount.set(contents.totalCount ?? contents.subfolders.length + contents.files.length);
        },
        error: () => {},
      });
  }

  loadCurrentFolder(): void {
    if (!this.isBrowsing()) {
      return;
    }
    this._folderLoading.set(true);
    this.service
      .getFolderContents(this.ownerType(), this.ownerId(), this.currentFolderId(), this.buildQueryOpts())
      .subscribe({
        next: contents => {
          const total = contents.totalCount ?? contents.subfolders.length + contents.files.length;
          // Si borraron/movieron items y esta página quedó vacía pero hay contenido antes, retrocede.
          if (contents.subfolders.length === 0 && contents.files.length === 0 && this._page() > 0 && total > 0) {
            this._page.set(Math.min(this._page() - 1, Math.max(0, Math.ceil(total / this.pageSize) - 1)));
            this.loadCurrentFolder();
            return;
          }
          this._subfolders.set(contents.subfolders);
          this._files.set(contents.files);
          this._totalCount.set(total);
          this._folderLoading.set(false);
        },
        error: err => {
          this._folderLoading.set(false);
          this.toast.error(toUserMessage(err));
        },
      });
  }

  /** Va a una página (0-based, clamped) y recarga. */
  private goToPage(page: number): void {
    const clamped = Math.max(0, Math.min(page, this.pageCount() - 1));
    if (clamped === this._page()) {
      return;
    }
    this._page.set(clamped);
    this._selectedFileId.set(null);
    this.loadCurrentFolder();
  }

  nextPage(): void {
    this.goToPage(this._page() + 1);
  }

  prevPage(): void {
    this.goToPage(this._page() - 1);
  }

  openFolder(folder: FolderResponse): void {
    this._breadcrumbs.update(crumbs => [...crumbs, folder]);
    this._selectedFileId.set(null);
    this._page.set(0);
    this.loadCurrentFolder();
  }

  goToRoot(): void {
    this._breadcrumbs.set([]);
    this._selectedFileId.set(null);
    this._page.set(0);
    this.loadCurrentFolder();
  }

  goToBreadcrumb(folder: FolderResponse): void {
    this._breadcrumbs.update(crumbs => {
      const index = crumbs.findIndex(c => c.id === folder.id);
      return index === -1 ? crumbs : crumbs.slice(0, index + 1);
    });
    this._selectedFileId.set(null);
    this._page.set(0);
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
        // null (no "") para la oficina: "" no bindea a Guid? y el backend responde 400.
        ownerId: this.ownerId(),
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
    // Borrado recursivo: el backend manda el contenido a la papelera y elimina el subárbol.
    this.service.deleteFolder(folder.id).subscribe({
      next: () => {
        this.toast.success(`"${folder.name}" moved to the recycle bin`);
        this.loadCurrentFolder();
      },
      // Folder.HasLegalHold si tiene archivos en retención legal → toast del catálogo.
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
      // null (no "") para la oficina: "" no bindea a Guid? y el backend responde 400.
      ownerId: this.ownerId(),
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
    this.loadFileShares(file.id);
  }

  clearSelection(): void {
    this._selectedFileId.set(null);
    this._fileShares.set([]);
  }

  /** Carga los links de un archivo (panel de detalle y diálogo de compartir). */
  loadFileShares(fileId: string): void {
    this._fileSharesFileId.set(fileId);
    this._fileShares.set([]);
    this._fileSharesLoading.set(true);
    this.service.listFileShares(fileId).subscribe({
      next: shares => {
        this._fileShares.set(shares);
        this._fileSharesLoading.set(false);
      },
      // Silencioso: la sección de links es secundaria; un fallo no debe romper el panel.
      error: () => this._fileSharesLoading.set(false),
    });
  }

  /** Carga los links de una carpeta (reusa la misma señal de shares del diálogo). */
  loadFolderShares(folderId: string): void {
    this._fileSharesFileId.set(folderId);
    this._fileShares.set([]);
    this._fileSharesLoading.set(true);
    this.service.listFolderShares(folderId).subscribe({
      next: shares => {
        this._fileShares.set(shares);
        this._fileSharesLoading.set(false);
      },
      error: () => this._fileSharesLoading.set(false),
    });
  }

  createFolderShareLink(folder: FolderResponse, req: CreateFolderShareLinkRequest): void {
    this.service.createFolderShareLink(folder.id, req).subscribe({
      next: created => {
        this._createdShare.set(created);
        if (this._fileSharesFileId() === folder.id) {
          this.loadFolderShares(folder.id);
        }
        this.refreshShareBadges();
      },
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  /** "Copy link" sobre un folder link copiable: crea uno nuevo preservando tipo+alcance y revoca el viejo. */
  reshareFolderLink(folder: FolderResponse, old: ShareLinkResponse): void {
    const req: CreateFolderShareLinkRequest = {
      visibility: old.visibility === 'ExternalLink' ? 'ExternalLink' : 'Public',
      permission: old.permission,
      password: null,
      expiresAtUtc: old.expiresAtUtc,
      maxAccessCount: old.maxAccessCount ?? null,
      recipientEmails: null,
      recipientLanguage: null,
      isRecursive: old.isRecursive,
      appliesToFutureItems: old.appliesToFutureItems,
    };
    this.service.createFolderShareLink(folder.id, req).subscribe({
      next: created => {
        this._createdShare.set(created);
        this.service.revokeShareLink(old.id).subscribe({
          next: () => {
            if (this._fileSharesFileId() === folder.id) {
              this.loadFolderShares(folder.id);
            }
          },
          error: () => {},
        });
      },
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  /**
   * "Compartir de nuevo" un link Public: como el token del viejo no se puede recuperar (solo se
   * emite al crear), se crea uno NUEVO con el mismo permiso/expiración y se REVOCA el viejo al
   * instante. El modal de "link creado" muestra la URL copiable. Solo aplica a Public — los otros
   * tipos no producen una URL pública que copiar.
   */
  resharePublicLink(file: FileResponse, old: ShareLinkResponse): void {
    const req: CreateShareLinkRequest = {
      // Preserva el tipo del link copiable (Public o Secure link/ExternalLink); no lo degrada a Public.
      visibility: old.visibility === 'ExternalLink' ? 'ExternalLink' : 'Public',
      permission: old.permission,
      password: null,
      expiresAtUtc: old.expiresAtUtc,
      maxAccessCount: old.maxAccessCount ?? null,
      recipientEmails: null,
      recipientLanguage: null,
    };
    this.service.createShareLink(file.id, req).subscribe({
      next: created => {
        this._createdShare.set(created);
        // El viejo ya no se puede copiar: se revoca al instante para no dejar dos links vivos.
        this.service.revokeShareLink(old.id).subscribe({
          next: () => {
            if (this._fileSharesFileId() === file.id) {
              this.loadFileShares(file.id);
            }
          },
          error: () => {},
        });
      },
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  /** Revoca un link y refresca la lista del archivo que se está mostrando (panel o diálogo). */
  revokeShare(shareLinkId: string): void {
    this.service.revokeShareLink(shareLinkId).subscribe({
      next: () => {
        const fileId = this._fileSharesFileId();
        if (fileId) {
          this.loadFileShares(fileId);
        }
        this.refreshShareBadges();
        this.toast.success('Share link revoked.');
      },
      error: err => this.toast.error(toUserMessage(err)),
    });
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
    // Una entrada de carpeta restaura todo su contenido; un archivo, solo el archivo.
    const restore$: Observable<unknown> =
      item.itemType === 'Folder' ? this.service.restoreFolder(item.id) : this.service.restoreFile(item.id);
    restore$.subscribe({
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
    // El orden es server-side: vuelve a página 1 y recarga.
    this._page.set(0);
    this.loadCurrentFolder();
  }

  toggleFilter(group: keyof FileFilters, value: string | number): void {
    this._filters.update(f => {
      const list = f[group] as (string | number)[];
      const next = list.includes(value) ? list.filter(x => x !== value) : [...list, value];
      return { ...f, [group]: next };
    });
    // Los filtros son server-side: vuelve a página 1 y recarga.
    this._page.set(0);
    this.loadCurrentFolder();
  }

  clearFilters(): void {
    this._filters.set(emptyFilters());
    this._page.set(0);
    this.loadCurrentFolder();
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
      next: created => {
        this._createdShare.set(created);
        // Refresca la lista de links del archivo que se está mostrando (panel o diálogo).
        if (this._fileSharesFileId() === file.id) {
          this.loadFileShares(file.id);
        }
        this.refreshShareBadges();
      },
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
