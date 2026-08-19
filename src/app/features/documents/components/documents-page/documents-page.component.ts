import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClientPickerComponent } from '../../ui/client-picker/client-picker.component';
import { FileBrowserComponent } from '../../ui/file-browser/file-browser.component';
import { RecycleBinComponent } from '../../ui/recycle-bin/recycle-bin.component';
import { DocumentsClientSummary } from '../../data-access/documents-clients.service';
import { DocumentsStore } from '../../data-access/documents.store';
import { FolderResponse } from '../../data-access/documents.model';

type DocumentsView = 'clients' | 'browser' | 'recycle-bin';

/**
 * Página del módulo Documents (migración #1 del roadmap Aether). Tres vistas
 * locales: selector de cliente → explorador de archivos → papelera. Único
 * contenedor "smart" de la feature — inyecta DocumentsStore (CloudStorage.Api
 * vía /storage + Customer.Api vía /customers) y lo cablea a las tres
 * presentacionales de `ui/` por input()/output().
 */
@Component({
  selector: 'app-documents-page',
  imports: [CommonModule, ClientPickerComponent, FileBrowserComponent, RecycleBinComponent],
  templateUrl: './documents-page.component.html',
})
export class DocumentsPageComponent {
  private readonly store = inject(DocumentsStore);

  readonly view = signal<DocumentsView>('clients');

  readonly clients = this.store.clients;
  readonly clientsLoading = this.store.clientsLoading;
  readonly clientsError = this.store.clientsError;

  readonly selectedClient = this.store.selectedClient;
  readonly breadcrumbs = this.store.breadcrumbs;
  readonly subfolders = this.store.subfolders;
  readonly files = this.store.files;
  readonly folderLoading = this.store.folderLoading;
  readonly folderError = this.store.folderError;
  readonly uploading = this.store.uploading;

  readonly recycleBinItems = this.store.recycleBinItems;
  readonly recycleBinLoading = this.store.recycleBinLoading;
  readonly recycleBinError = this.store.recycleBinError;

  constructor() {
    this.store.refreshClients();
  }

  onClientSearch(term: string): void {
    this.store.setClientSearch(term);
  }

  onClientSelected(client: DocumentsClientSummary): void {
    this.store.selectClient(client);
    this.view.set('browser');
  }

  backToClients(): void {
    this.store.clearSelectedClient();
    this.view.set('clients');
  }

  showRecycleBin(): void {
    this.store.loadRecycleBin();
    this.view.set('recycle-bin');
  }

  backToBrowser(): void {
    this.view.set('browser');
  }

  onOpenFolder(folder: FolderResponse): void {
    this.store.openFolder(folder);
  }

  onGoToRoot(): void {
    this.store.goToRoot();
  }

  onGoToBreadcrumb(folder: FolderResponse): void {
    this.store.goToBreadcrumb(folder);
  }

  onCreateFolder(name: string): void {
    this.store.createFolder(name);
  }

  onFilesSelected(files: FileList): void {
    this.store.uploadFiles(files);
  }

  onDownloadFile(fileId: string): void {
    this.store.downloadFile(fileId);
  }

  onDeleteFile(fileId: string): void {
    this.store.deleteFile(fileId);
  }

  onRestoreFile(fileId: string): void {
    this.store.restoreFile(fileId);
  }

  onEmptyRecycleBin(): void {
    this.store.emptyRecycleBin();
  }
}
