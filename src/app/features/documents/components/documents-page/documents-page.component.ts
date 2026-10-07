import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { injectEmbeddedCustomer } from '@core/customers/embedded-customer';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { ClickOutsideDirective } from '@shared/directives/click-outside.directive';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { FilterChipOption, FilterChipsComponent } from '@shared/ui/filter-chips/filter-chips.component';
import { ClipboardService } from '@shared/services/clipboard.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { formatBytes } from '@shared/utils/format.util';
import { DocumentsPermissions } from '../../data-access/documents-permissions';
import { DocumentsStore } from '../../data-access/documents.store';
import { CustomerStatusFilter, CustomerSummary } from '@core/customers/customer-summary.model';
import {
  CreateShareLinkRequest,
  CreateFolderShareLinkRequest,
  FileResponse,
  FolderResponse,
  RecycleBinItemResponse,
  ShareLinkResponse,
  formatDate,
  isFileReady,
} from '../../data-access/documents.model';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { FileViewerComponent } from '@shared/ui/file-viewer/file-viewer.component';
import { FileViewerDownload, FileViewerItem } from '@shared/ui/file-viewer/file-viewer.model';
import { DocumentNavigatorComponent } from '../../ui/document-navigator/document-navigator.component';
import { FileListComponent, FileRowAction } from '../../ui/file-list/file-list.component';
import { FileDetailsPanelComponent } from '../../ui/file-details-panel/file-details-panel.component';
import { DocumentPreviewComponent } from '../../ui/document-preview/document-preview.component';
import { UploadDialogComponent } from '../../ui/upload-dialog/upload-dialog.component';
import { MoveDialogComponent } from '../../ui/move-dialog/move-dialog.component';
import { NamePromptDialogComponent } from '../../ui/name-prompt-dialog/name-prompt-dialog.component';
import { BulkActionBarComponent } from '../../ui/bulk-action-bar/bulk-action-bar.component';
import { ShareDialogComponent } from '../../ui/share-dialog/share-dialog.component';

/** Elemento que se está moviendo (archivo o carpeta) — el diálogo de destino es el mismo. */
type MoveTarget = { file: FileResponse; folder?: undefined } | { folder: FolderResponse; file?: undefined };

/**
 * Contenedor "smart" del gestor documental. Único punto que inyecta el
 * DocumentsStore y lo cablea al navegador y a las presentacionales por
 * input()/output(). El cliente es un contexto dentro del workspace, no una
 * pantalla previa: entrar a Documents abre directo el gestor.
 *
 * Modo embebido (`injectEmbeddedCustomer()`, ver `@core/customers/embedded-customer`): lo monta
 * `ClientDocumentsWorkspaceComponent` dentro del perfil del cliente. Sin navegador lateral ni salto a Office/Clients: el gestor queda fijo al
 * workspace de ESE cliente (carpetas, filtros, orden, subir, mover, compartir…).
 */
@Component({
  selector: 'app-documents-page',
  imports: [
    ModalComponent,
    DropdownMenuComponent,
    MenuItemDirective,
    ClickOutsideDirective,
    StateBlockComponent,
    PaginationComponent,
    AvatarComponent,
    SearchInputComponent,
    FilterChipsComponent,
    ConfirmDialogComponent,
    DocumentNavigatorComponent,
    FileListComponent,
    FileDetailsPanelComponent,
    DocumentPreviewComponent,
    FileViewerComponent,
    UploadDialogComponent,
    MoveDialogComponent,
    NamePromptDialogComponent,
    BulkActionBarComponent,
    ShareDialogComponent,
  ],
  templateUrl: './documents-page.component.html',
  styleUrl: './documents-page.component.css',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class DocumentsPageComponent implements OnInit {

  /** B6 — qué acciones puede ofrecer esta pantalla. Antes no se gateaba ninguna. */
  protected readonly can = inject(DocumentsPermissions);

  private readonly store = inject(DocumentsStore);
  private readonly clipboard = inject(ClipboardService);
  private readonly toast = inject(ToastService);
  private readonly cloudStorage = inject(CloudStorageUploadService);

  // Estado del store expuesto al template.
  readonly context = this.store.context;
  readonly section = this.store.section;
  readonly isBrowsing = this.store.isBrowsing;
  readonly clients = this.store.clients;
  readonly clientsTotal = this.store.clientsTotal;
  readonly clientSearch = this.store.clientSearch;
  readonly clientsLoading = this.store.clientsLoading;
  readonly clientsPage = this.store.clientsPage;
  readonly clientsStatus = this.store.clientsStatus;
  readonly clientsPageCount = this.store.clientsPageCount;
  readonly clientsPageSize = this.store.clientsPageSize;
  readonly clientsFiltered = this.store.clientsFiltered;
  /** Filtros de estado del selector, en el orden en que se ofrecen. */
  readonly clientStatusOptions: ReadonlyArray<FilterChipOption<CustomerStatusFilter>> = [
    { id: 'NotArchived', label: 'Active & inactive' },
    { id: 'Active', label: 'Active' },
    { id: 'Inactive', label: 'Inactive' },
    { id: 'Archived', label: 'Archived' },
    { id: 'All', label: 'All' },
  ];
  readonly breadcrumbs = this.store.breadcrumbs;
  readonly subfolders = this.store.subfolders;
  readonly files = this.store.files;
  readonly folderLoading = this.store.folderLoading;
  // Paginación server-side del contenido de carpeta.
  readonly page = this.store.page;
  readonly totalCount = this.store.totalCount;
  readonly pageSize = this.store.pageSize;
  readonly selectedFile = this.store.selectedFile;
  readonly folderTree = this.store.folderTree;
  readonly recycleBinItems = this.store.recycleBinItems;
  readonly recycleBinLoading = this.store.recycleBinLoading;
  readonly recent = this.store.recent;
  readonly recentLoading = this.store.recentLoading;
  readonly usage = this.store.usage;
  // Fase 4: vista/filtros/orden, multiselección, compartir, shared-with-me.
  readonly visibleFiles = this.store.visibleFiles;
  readonly viewMode = this.store.viewMode;
  readonly sort = this.store.sort;
  readonly filters = this.store.filters;
  readonly activeFilterCount = this.store.activeFilterCount;
  readonly selectedIds = this.store.selectedIds;
  readonly selectionCount = this.store.selectionCount;
  readonly hasSelection = this.store.hasSelection;
  readonly sharedWithMe = this.store.sharedWithMe;
  readonly sharedLoading = this.store.sharedLoading;
  readonly createdShare = this.store.createdShare;
  readonly fileShares = this.store.fileShares;
  readonly fileSharesLoading = this.store.fileSharesLoading;
  /**
   * B5 — tres estados, no un booleano. `GET /storage/usage` pide `cloudstorage.settings.manage`:
   * un empleado recibe 403 y `usage()` queda en null. Con el booleano de antes eso se leía como
   * "la oficina lo tiene apagado", que es una afirmación que la aplicación no puede hacer.
   */
  readonly publicSharing = computed<'enabled' | 'disabled' | 'unknown'>(() => {
    const usage = this.usage();
    if (!usage) {
      return 'unknown';
    }
    return usage.allowPublicShareLinks ? 'enabled' : 'disabled';
  });

  // Estado local de la vista (menús/diálogos).
  readonly filtersOpen = signal(false);
  readonly sortOpen = signal(false);
  readonly uploadOpen = signal(false);
  readonly newFolderOpen = signal(false);
  readonly renameTarget = signal<FolderResponse | null>(null);
  readonly moveTarget = signal<MoveTarget | null>(null);
  readonly shareTarget = signal<FileResponse | null>(null);
  readonly shareFolderTarget = signal<FolderResponse | null>(null);
  /** Link pendiente de revocar; abre el confirm-dialog compartido (id del share). */
  readonly pendingRevoke = signal<string | null>(null);
  /** Carpeta pendiente de borrar; abre el confirm-dialog (el borrado es recursivo → papelera). */
  readonly pendingDeleteFolder = signal<FolderResponse | null>(null);
  readonly storageOpen = signal(false);
  readonly emptyTrashOpen = signal(false);
  /** Archivo aún no listo (procesando/bloqueado): tarjeta de estado en vez del visor. */
  readonly previewFile = signal<FileResponse | null>(null);
  /** Visor global: lista navegable (los archivos listos de la vista actual) y posición. */
  readonly viewerOpen = signal(false);
  readonly viewerFiles = signal<FileViewerItem[]>([]);
  readonly viewerIndex = signal(0);

  readonly filterYears = [2025, 2024, 2023];
  readonly filterTypes = ['PDF', 'XLSX', 'DOCX', 'JPG', 'ZIP'];
  readonly filterStatuses = ['ready', 'processing', 'blocked'] as const;

  /** Cliente fijo cuando la página va embebida en el perfil; `null` en /documents. */
  private readonly embeddedCustomer = injectEmbeddedCustomer();
  readonly embedded = computed(() => this.embeddedCustomer() !== null);

  readonly title = computed(() => {
    const crumbs = this.breadcrumbs();
    if (this.isBrowsing() && crumbs.length > 0) {
      return crumbs[crumbs.length - 1].name;
    }
    if (this.embedded()) {
      return 'Documents';
    }
    switch (this.section()) {
      case 'office':
        return 'Office Files';
      case 'clients':
        return 'Clients';
      case 'client':
        return this.context().clientName ?? 'Client documents';
      case 'recent':
        return 'Recent';
      case 'shared':
        return 'Shared with Me';
      default:
        return 'Recycle Bin';
    }
  });

  readonly subtitle = computed(() => {
    if (this.embedded()) {
      return `Files stored for ${this.context().clientName ?? 'this client'}`;
    }
    switch (this.section()) {
      case 'office':
        return 'Documents that belong to the office, not to a single client.';
      case 'clients':
        return 'Open a client to work on their documents.';
      case 'client':
        return 'Client documents';
      case 'recent':
        return 'The files your office worked on lately.';
      case 'shared':
        return 'Files and folders your teammates shared with you.';
      default:
        return 'Items are automatically removed after 30 days.';
    }
  });

  /** Etiqueta del dueño para el diálogo de subida y el destino de "mover". */
  readonly ownerLabel = computed(() =>
    this.section() === 'client' ? (this.context().clientName ?? 'Client') : 'Office Files',
  );

  readonly currentFolderLabel = computed(() => {
    const crumbs = this.breadcrumbs();
    return crumbs.length > 0 ? crumbs[crumbs.length - 1].name : this.ownerLabel();
  });

  constructor() {
    // Embebida: abre (y reabre si cambia) el workspace del cliente fijado por el perfil.
    effect(() => {
      const customer = this.embeddedCustomer();
      if (customer && customer.id !== untracked(this.context).clientId) {
        untracked(() => this.store.openClientById(customer.id, customer.name));
      }
    });
  }

  ngOnInit(): void {
    if (this.embedded()) {
      return;
    }
    this.store.refreshClients();
    this.store.loadUsage();
    this.store.openOffice();
  }

  // ---------- Navegador ----------
  openOffice(): void {
    this.store.openOffice();
  }
  openClients(): void {
    this.store.openClients();
  }
  openClient(client: CustomerSummary): void {
    this.store.openClient(client);
  }
  openRecent(): void {
    this.store.openRecent();
  }
  openShared(): void {
    this.store.openSharedWithMe();
  }
  openTrash(): void {
    this.store.openRecycleBin();
  }
  searchClients(term: string): void {
    this.store.setClientSearch(term);
  }
  setClientsStatus(status: CustomerStatusFilter): void {
    this.store.setClientsStatus(status);
  }
  goToClientsPage(page: number): void {
    this.store.setClientsPage(page);
  }
  clearClientFilters(): void {
    this.store.clearClientFilters();
  }
  openStorage(): void {
    this.store.loadUsage();
    this.storageOpen.set(true);
  }

  // ---------- Breadcrumbs ----------
  goToRoot(): void {
    this.store.goToRoot();
  }
  goToBreadcrumb(folder: FolderResponse): void {
    this.store.goToBreadcrumb(folder);
  }

  // ---------- Menú "New" ----------
  startUpload(): void {
    this.uploadOpen.set(true);
  }
  startNewFolder(): void {
    this.newFolderOpen.set(true);
  }

  // ---------- Acciones de fila ----------
  onRowAction(action: FileRowAction): void {
    switch (action.kind) {
      case 'open-folder':
        this.store.openFolder(action.folder);
        break;
      case 'rename-folder':
        this.renameTarget.set(action.folder);
        break;
      case 'move-folder':
        this.openMove({ folder: action.folder });
        break;
      case 'share-folder':
        this.shareFolderTarget.set(action.folder);
        this.store.loadFolderShares(action.folder.id);
        break;
      case 'delete-folder':
        this.pendingDeleteFolder.set(action.folder);
        break;
      case 'select-file':
        this.store.selectFile(action.file);
        break;
      case 'toggle-file':
        this.store.toggleFileSelection(action.file.id);
        break;
      case 'preview-file':
        this.openPreview(action.file, this.visibleFiles());
        break;
      case 'download-file':
        this.store.downloadFile(action.file);
        break;
      case 'share-file':
        this.shareTarget.set(action.file);
        this.store.loadFileShares(action.file.id);
        break;
      case 'move-file':
        this.openMove({ file: action.file });
        break;
      case 'delete-file':
        this.store.deleteFile(action.file.id);
        break;
    }
  }

  // ---------- Toolbar: filtros / orden / vista ----------
  toggleFiltersMenu(): void {
    this.filtersOpen.update(o => !o);
  }
  toggleSortMenu(): void {
    this.sortOpen.update(o => !o);
  }
  toggleFilter(group: 'years' | 'types' | 'statuses', value: string | number): void {
    this.store.toggleFilter(group, value);
  }
  clearFilters(): void {
    this.store.clearFilters();
  }
  setSort(key: 'name' | 'modified' | 'size'): void {
    this.store.setSort(key);
    this.sortOpen.set(false);
  }
  setView(mode: 'list' | 'grid'): void {
    this.store.setViewMode(mode);
  }
  toggleSelectAll(): void {
    this.store.toggleSelectAll();
  }

  // ---------- Barra en lote ----------
  bulkDownload(): void {
    this.store.downloadSelected();
  }
  bulkMove(): void {
    this.store.loadFolderTree();
    this.moveTarget.set({ file: this.store.selectedFiles()[0] });
    this.bulkMoveMode.set(true);
  }
  bulkDelete(): void {
    this.store.deleteSelected();
  }
  clearSelection(): void {
    this.store.clearFileSelection();
  }
  readonly bulkMoveMode = signal(false);

  // ---------- Compartir ----------
  confirmShare(req: CreateShareLinkRequest): void {
    const file = this.shareTarget();
    if (file) {
      this.store.createShareLink(file, req);
    }
    this.shareTarget.set(null);
  }

  confirmFolderShare(req: CreateFolderShareLinkRequest): void {
    const folder = this.shareFolderTarget();
    if (folder) {
      this.store.createFolderShareLink(folder, req);
    }
    this.shareFolderTarget.set(null);
  }

  /** "Copy link" sobre un link copiable existente: crea uno nuevo (copiable) y revoca el viejo. */
  reshareLink(share: ShareLinkResponse): void {
    const folder = this.shareFolderTarget();
    if (folder) {
      this.store.reshareFolderLink(folder, share);
      this.shareFolderTarget.set(null);
      return;
    }
    const file = this.shareTarget();
    if (file) {
      this.store.resharePublicLink(file, share);
    }
    // Cierra el diálogo; aparece el modal de "link creado" con la URL nueva copiable.
    this.shareTarget.set(null);
  }

  closeShareDialog(): void {
    this.shareTarget.set(null);
    this.shareFolderTarget.set(null);
  }
  closeCreatedShare(): void {
    this.store.clearCreatedShare();
  }
  async copyShareLink(): Promise<void> {
    const created = this.createdShare();
    if (created && !(await this.clipboard.copy(this.shareUrl(created.plainToken)))) {
      // El link solo se muestra una vez: si no se pudo copiar, el modal sigue abierto para copiarlo a mano.
      this.toast.error("Couldn't copy the link. Copy it manually before closing.");
      return;
    }
    this.store.clearCreatedShare();
  }
  shareUrl(token: string): string {
    // Mismo origen que la oficina actual: en prod es su subdominio (`https://<oficina>.taxproffice.com`),
    // donde vive la página pública `/s/:token`; en dev es el mismo host del CRM.
    return `${window.location.origin}/s/${token}`;
  }

  confirmDeleteFolder(): void {
    const folder = this.pendingDeleteFolder();
    if (folder) {
      this.store.deleteFolder(folder);
    }
    this.pendingDeleteFolder.set(null);
  }

  nextPage(): void {
    this.store.nextPage();
  }

  prevPage(): void {
    this.store.prevPage();
  }

  revokeShare(shareLinkId: string): void {
    // Irreversible: se confirma con el diálogo compartido antes de ejecutar.
    this.pendingRevoke.set(shareLinkId);
  }

  confirmRevoke(): void {
    const id = this.pendingRevoke();
    if (id) {
      this.store.revokeShare(id);
    }
    this.pendingRevoke.set(null);
  }

  // ---------- Diálogos ----------
  confirmUpload(files: File[]): void {
    this.store.uploadFiles(files);
    this.uploadOpen.set(false);
  }

  confirmNewFolder(name: string): void {
    this.store.createFolder(name);
    this.newFolderOpen.set(false);
  }

  confirmRename(name: string): void {
    const target = this.renameTarget();
    if (target) {
      this.store.renameFolder(target, name);
    }
    this.renameTarget.set(null);
  }

  private openMove(target: MoveTarget): void {
    this.store.loadFolderTree();
    this.moveTarget.set(target);
  }

  confirmMove(targetFolderId: string | null): void {
    if (this.bulkMoveMode()) {
      this.store.moveSelected(targetFolderId);
      this.closeMove();
      return;
    }
    const target = this.moveTarget();
    if (target?.file) {
      this.store.moveFile(target.file.id, targetFolderId);
    } else if (target?.folder) {
      this.store.moveFolder(target.folder, targetFolderId);
    }
    this.moveTarget.set(null);
  }

  closeMove(): void {
    this.moveTarget.set(null);
    this.bulkMoveMode.set(false);
  }

  confirmEmptyTrash(): void {
    this.store.emptyRecycleBin();
    this.emptyTrashOpen.set(false);
  }

  // ---------- Panel de detalles / preview ----------

  /**
   * Abre el visor global con los archivos LISTOS de la lista (se navega entre ellos con ←/→).
   * Un archivo procesando o bloqueado no se puede bajar: muestra la tarjeta de estado.
   */
  openPreview(file: FileResponse, list: readonly FileResponse[]): void {
    if (!isFileReady(file.status)) {
      this.previewFile.set(file);
      return;
    }
    const ready = list.filter(f => isFileReady(f.status));
    const files = ready.some(f => f.id === file.id) ? ready : [file];
    this.viewerFiles.set(files.map(f => this.cloudStorage.viewerItem(f)));
    this.viewerIndex.set(Math.max(0, files.findIndex(f => f.id === file.id)));
    this.viewerOpen.set(true);
  }

  onViewerDownload(event: FileViewerDownload): void {
    this.store.downloadFile(event.item.ref as FileResponse);
  }
  closeDetails(): void {
    this.store.clearSelection();
  }
  downloadFile(file: FileResponse): void {
    this.store.downloadFile(file);
  }
  moveFromDetails(file: FileResponse): void {
    this.openMove({ file });
  }
  deleteFromDetails(file: FileResponse): void {
    this.store.deleteFile(file.id);
  }

  // ---------- Papelera ----------
  restoreItem(item: RecycleBinItemResponse): void {
    this.store.restoreFile(item);
  }

  // ---------- Helpers de presentación ----------
  moveItemLabel(): string {
    if (this.bulkMoveMode()) {
      const n = this.selectionCount();
      return `${n} ${n === 1 ? 'item' : 'items'}`;
    }
    const target = this.moveTarget();
    if (target?.file) {
      return `"${target.file.originalName}"`;
    }
    if (target?.folder) {
      return `"${target.folder.name}"`;
    }
    return '';
  }

  moveExcludeId(): string | null {
    return this.moveTarget()?.folder?.id ?? null;
  }

  detailsLocation(): string {
    const segments = [this.section() === 'client' ? `Clients / ${this.context().clientName ?? ''}` : 'Office Files'];
    for (const crumb of this.breadcrumbs()) {
      segments.push(crumb.name);
    }
    return segments.join(' / ');
  }

  size(bytes: number): string {
    return formatBytes(bytes);
  }

  date(iso: string): string {
    return formatDate(iso);
  }

  daysLeft(item: RecycleBinItemResponse): number {
    const ms = new Date(item.softDeleteExpiresAtUtc).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86_400_000));
  }

  usedGb(bytes: number): string {
    return (bytes / 1024 ** 3).toFixed(1);
  }
}
