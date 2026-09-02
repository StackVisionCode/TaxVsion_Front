import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { DocumentsStore } from '../../data-access/documents.store';
import { DocumentsClientSummary } from '../../data-access/documents-clients.service';
import {
  CreateShareLinkRequest,
  FileResponse,
  FolderResponse,
  RecycleBinItemResponse,
  ShareLinkResponse,
  formatBytes,
  formatDate,
} from '../../data-access/documents.model';
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
 */
@Component({
  selector: 'app-documents-page',
  imports: [
    ModalComponent,
    ConfirmDialogComponent,
    DocumentNavigatorComponent,
    FileListComponent,
    FileDetailsPanelComponent,
    DocumentPreviewComponent,
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
export class DocumentsPageComponent {
  private readonly store = inject(DocumentsStore);

  // Estado del store expuesto al template.
  readonly context = this.store.context;
  readonly section = this.store.section;
  readonly isBrowsing = this.store.isBrowsing;
  readonly clients = this.store.clients;
  readonly clientsTotal = this.store.clientsTotal;
  readonly clientSearch = this.store.clientSearch;
  readonly clientsLoading = this.store.clientsLoading;
  readonly breadcrumbs = this.store.breadcrumbs;
  readonly subfolders = this.store.subfolders;
  readonly files = this.store.files;
  readonly folderLoading = this.store.folderLoading;
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
  readonly publicSharingAllowed = computed(() => this.usage()?.allowPublicShareLinks ?? false);

  // Estado local de la vista (menús/diálogos).
  readonly newMenuOpen = signal(false);
  readonly filtersOpen = signal(false);
  readonly sortOpen = signal(false);
  readonly uploadOpen = signal(false);
  readonly newFolderOpen = signal(false);
  readonly renameTarget = signal<FolderResponse | null>(null);
  readonly moveTarget = signal<MoveTarget | null>(null);
  readonly shareTarget = signal<FileResponse | null>(null);
  readonly storageOpen = signal(false);
  readonly emptyTrashOpen = signal(false);
  readonly previewFile = signal<FileResponse | null>(null);

  readonly filterYears = [2025, 2024, 2023];
  readonly filterTypes = ['PDF', 'XLSX', 'DOCX', 'JPG', 'ZIP'];
  readonly filterStatuses = ['ready', 'processing', 'blocked'] as const;

  readonly title = computed(() => {
    const crumbs = this.breadcrumbs();
    if (this.isBrowsing() && crumbs.length > 0) {
      return crumbs[crumbs.length - 1].name;
    }
    switch (this.section()) {
      case 'office':
        return 'Office Files';
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
    switch (this.section()) {
      case 'office':
        return 'Documents that belong to the office, not to a single client.';
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
    this.store.refreshClients();
    this.store.loadUsage();
    this.store.openOffice();
  }

  // ---------- Navegador ----------
  openOffice(): void {
    this.store.openOffice();
  }
  openClient(client: DocumentsClientSummary): void {
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
  toggleNewMenu(): void {
    this.newMenuOpen.update(open => !open);
  }
  startUpload(): void {
    this.newMenuOpen.set(false);
    this.uploadOpen.set(true);
  }
  startNewFolder(): void {
    this.newMenuOpen.set(false);
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
      case 'delete-folder':
        this.store.deleteFolder(action.folder);
        break;
      case 'select-file':
        this.store.selectFile(action.file);
        break;
      case 'toggle-file':
        this.store.toggleFileSelection(action.file.id);
        break;
      case 'preview-file':
        this.previewFile.set(action.file);
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

  /** "Copy link" sobre un Public existente: crea uno nuevo (copiable) y revoca el viejo. */
  reshareLink(share: ShareLinkResponse): void {
    const file = this.shareTarget();
    if (file) {
      this.store.resharePublicLink(file, share);
    }
    // Cierra el diálogo; aparece el modal de "link creado" con la URL nueva copiable.
    this.shareTarget.set(null);
  }
  closeCreatedShare(): void {
    this.store.clearCreatedShare();
  }
  copyShareLink(): void {
    const created = this.createdShare();
    if (created) {
      void navigator.clipboard?.writeText(this.shareUrl(created.plainToken));
    }
    this.store.clearCreatedShare();
  }
  shareUrl(token: string): string {
    // Mismo origen que la oficina actual: en prod es su subdominio (`https://<oficina>.taxproffice.com`),
    // donde vive la página pública `/s/:token`; en dev es el mismo host del CRM.
    return `${window.location.origin}/s/${token}`;
  }

  revokeShare(shareLinkId: string): void {
    // Irreversible: se confirma antes. Si el usuario cancela, no pasa nada.
    if (confirm('Revoke this link? Anyone using it will lose access immediately.')) {
      this.store.revokeShare(shareLinkId);
    }
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
