import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClientPickerComponent, DocumentsClient } from '../../ui/client-picker/client-picker.component';
import { FileBrowserComponent } from '../../ui/file-browser/file-browser.component';
import { RecycleBinComponent } from '../../ui/recycle-bin/recycle-bin.component';

type DocumentsView = 'clients' | 'browser' | 'recycle-bin';

/**
 * Página del módulo Documents (migración #1 del roadmap Aether). Tres vistas
 * locales: selector de cliente → explorador de archivos → papelera. Todo
 * visual, datos estáticos en signals; reemplaza al god component de 3.3k
 * líneas del CRM original.
 */
@Component({
  selector: 'app-documents-page',
  imports: [CommonModule, ClientPickerComponent, FileBrowserComponent, RecycleBinComponent],
  templateUrl: './documents-page.component.html',
})
export class DocumentsPageComponent {
  readonly view = signal<DocumentsView>('clients');
  readonly selectedClient = signal<DocumentsClient | null>(null);

  onClientSelected(client: DocumentsClient): void {
    this.selectedClient.set(client);
    this.view.set('browser');
  }

  backToClients(): void {
    this.selectedClient.set(null);
    this.view.set('clients');
  }

  showRecycleBin(): void {
    this.view.set('recycle-bin');
  }

  backToBrowser(): void {
    this.view.set('browser');
  }
}
