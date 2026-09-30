import { Component, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { PermissionService } from '@core/auth/permission.service';
import { FileViewerComponent } from '@shared/ui/file-viewer/file-viewer.component';
import { FileViewerDownload, FileViewerItem } from '@shared/ui/file-viewer/file-viewer.model';
import { ClientDocumentsStore } from '../../data-access/client-documents.store';
import { ClientDocumentItem, ClientFolderItem } from '../../data-access/client-documents.model';
import {
  ClientDocumentsCaps,
  ClientProfileDocumentsComponent,
  FolderNameDialogState,
} from '../../ui/client-profile-documents/client-profile-documents.component';

/** Permisos de CloudStorage (BuildingBlocks.Authorization.CloudStoragePermissions). */
const FILE_VIEW = 'cloudstorage.file.view';
const FILE_UPLOAD = 'cloudstorage.file.upload';
const FILE_DOWNLOAD = 'cloudstorage.file.download';
const FILE_DELETE = 'cloudstorage.file.delete';
const FOLDER_MANAGE = 'cloudstorage.folder.manage';

/**
 * Contenedor de la pestaña Documents del perfil: conecta `ClientDocumentsStore` (carpetas del
 * cliente en CloudStorage) con la vista presentacional `app-client-profile-documents`.
 *
 * Vista previa con el visor global `app-file-viewer`: recibe los archivos LISTOS de la carpeta
 * abierta (para pasar al anterior/siguiente) y resuelve la URL presignada recién al mostrar cada
 * uno (`resolveUrl`), porque vencen en minutos.
 */
@Component({
  selector: 'app-client-documents-panel',
  imports: [ClientProfileDocumentsComponent, FileViewerComponent],
  template: `
    <app-client-profile-documents
      [clientName]="clientName"
      [folders]="store.folders()"
      [documents]="store.documents()"
      [path]="store.path()"
      [loading]="store.loading()"
      [error]="store.error()"
      [maybeTruncated]="store.maybeTruncated()"
      [uploading]="store.uploading()"
      [busyIds]="store.busyIds()"
      [caps]="caps()"
      [folderDialog]="folderDialog()"
      [savingFolder]="store.savingFolder()"
      (openFolder)="store.openFolder($event)"
      (goToCrumb)="store.goToCrumb($event)"
      (upload)="store.uploadFiles($event)"
      (download)="store.download($event)"
      (preview)="onPreview($event)"
      (remove)="store.remove($event)"
      (retry)="store.refresh()"
      (requestCreateFolder)="openCreateFolder()"
      (requestRenameFolder)="openRenameFolder($event)"
      (submitFolderName)="onSubmitFolderName($event)"
      (cancelFolderDialog)="folderDialog.set(null)"
    ></app-client-profile-documents>

    <app-file-viewer
      [isOpen]="viewerOpen()"
      [files]="viewerFiles()"
      [startIndex]="viewerIndex()"
      [allowDownload]="caps().canDownload"
      (closed)="viewerOpen.set(false)"
      (indexChange)="viewerIndex.set($event)"
      (download)="onViewerDownload($event)"
    ></app-file-viewer>
  `,
})
export class ClientDocumentsPanelComponent implements OnChanges {
  @Input() clientId = '';
  @Input() clientName = '';

  readonly store = inject(ClientDocumentsStore);
  private readonly perms = inject(PermissionService);

  readonly caps = computed<ClientDocumentsCaps>(() => ({
    canView: this.perms.has(FILE_VIEW),
    canUpload: this.perms.has(FILE_UPLOAD),
    canDownload: this.perms.has(FILE_DOWNLOAD),
    canDelete: this.perms.has(FILE_DELETE),
    canManageFolders: this.perms.has(FOLDER_MANAGE),
  }));

  readonly folderDialog = signal<FolderNameDialogState | null>(null);

  // ---------- Visor ----------
  readonly viewerOpen = signal(false);
  readonly viewerIndex = signal(0);
  /** Archivos listos de la carpeta abierta, en el orden de la lista. */
  private readonly previewable = computed(() => this.store.documents().filter(doc => doc.isReady));
  readonly viewerFiles = computed<FileViewerItem[]>(() =>
    this.previewable().map(doc => ({
      name: doc.name,
      resolveUrl: () => this.store.downloadUrl(doc),
      ref: doc,
    })),
  );

  ngOnChanges(): void {
    if (this.clientId) {
      this.store.load(this.clientId);
    }
  }

  openCreateFolder(): void {
    this.folderDialog.set({ mode: 'create', folderId: null, initialName: '' });
  }

  openRenameFolder(folder: ClientFolderItem): void {
    this.folderDialog.set({ mode: 'rename', folderId: folder.id, initialName: folder.name });
  }

  onSubmitFolderName(name: string): void {
    const dialog = this.folderDialog();
    if (!dialog) {
      return;
    }
    const call$ =
      dialog.mode === 'rename' && dialog.folderId
        ? this.store.renameFolder(dialog.folderId, name)
        : this.store.createFolder(name);
    call$.subscribe(ok => {
      if (ok) {
        this.folderDialog.set(null);
      }
    });
  }

  onPreview(doc: ClientDocumentItem): void {
    const index = this.previewable().findIndex(item => item.id === doc.id);
    if (index < 0) {
      return;
    }
    this.viewerIndex.set(index);
    this.viewerOpen.set(true);
  }

  /** Descargar desde el visor: mismo camino que el botón de la fila (URL presignada fresca). */
  onViewerDownload(event: FileViewerDownload): void {
    this.store.download(event.item.ref as ClientDocumentItem);
  }
}
