import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  FileKind,
  FileResponse,
  FileStatus,
  FolderResponse,
  formatBytes,
  formatDate,
  isFilePending,
  kindFromFileName,
} from '../../data-access/documents.model';

/**
 * Explorador de archivos del módulo Documents (estilo "Aether"): breadcrumbs
 * píldora, toggle tabla/grid, búsqueda local (sobre la carpeta ya cargada) y
 * navegación real de carpetas. Presentacional puro — datos y navegación
 * vienen de DocumentsStore vía el contenedor `documents-page`; acá solo se
 * arma el `FileList` del `<input type="file">` y se emite.
 */
@Component({
  selector: 'app-file-browser',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './file-browser.component.html',
})
export class FileBrowserComponent {
  @Input() clientName = '';
  @Input() breadcrumbs: FolderResponse[] = [];
  @Input() subfolders: FolderResponse[] = [];
  @Input() files: FileResponse[] = [];
  @Input() loading = false;
  @Input() error: string | null = null;
  @Input() uploading = false;

  @Output() back = new EventEmitter<void>();
  @Output() openRecycleBin = new EventEmitter<void>();
  @Output() openFolder = new EventEmitter<FolderResponse>();
  @Output() goToRoot = new EventEmitter<void>();
  @Output() goToBreadcrumb = new EventEmitter<FolderResponse>();
  @Output() createFolder = new EventEmitter<string>();
  @Output() filesSelected = new EventEmitter<FileList>();
  @Output() downloadFile = new EventEmitter<string>();
  @Output() deleteFile = new EventEmitter<string>();

  readonly searchTerm = signal('');
  readonly viewMode = signal<'table' | 'grid'>('table');

  visibleFolders(): FolderResponse[] {
    const term = this.searchTerm().trim().toLowerCase();
    return this.subfolders.filter(f => !term || f.name.toLowerCase().includes(term));
  }

  visibleFiles(): FileResponse[] {
    const term = this.searchTerm().trim().toLowerCase();
    return this.files.filter(f => !term || f.originalName.toLowerCase().includes(term));
  }

  isEmpty(): boolean {
    return !this.loading && this.visibleFolders().length === 0 && this.visibleFiles().length === 0;
  }

  addFolder(): void {
    const name = window.prompt('New folder name');
    if (name && name.trim()) {
      this.createFolder.emit(name.trim());
    }
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.filesSelected.emit(input.files);
    }
    input.value = '';
  }

  kind(file: FileResponse): FileKind {
    return kindFromFileName(file.originalName);
  }

  size(file: FileResponse): string {
    return formatBytes(file.sizeBytes);
  }

  date(file: FileResponse): string {
    return formatDate(file.createdAtUtc);
  }

  isPending(file: FileResponse): boolean {
    return isFilePending(file.status);
  }

  statusLabel(status: FileStatus): string {
    switch (status) {
      case 'PendingUpload':
      case 'PendingScan':
        return 'Scanning queued';
      case 'Scanning':
        return 'Scanning…';
      case 'Infected':
      case 'ScanFailed':
      case 'BlockedByPolicy':
        return 'Blocked';
      case 'PendingReview':
        return 'In review';
      default:
        return status;
    }
  }

  kindIcon(kind: FileKind): string {
    switch (kind) {
      case 'pdf':
        return 'document-text-outline';
      case 'xlsx':
        return 'stats-chart-outline';
      case 'img':
        return 'image-outline';
      case 'doc':
        return 'document-outline';
    }
  }

  kindCircle(kind: FileKind): string {
    switch (kind) {
      case 'pdf':
        return 'bg-indigo-50';
      case 'xlsx':
        return 'bg-indigo-100';
      case 'img':
        return 'bg-gray-200';
      case 'doc':
        return 'bg-indigo-100';
    }
  }

  kindChip(kind: FileKind): string {
    switch (kind) {
      case 'pdf':
        return 'border-orange-200 text-orange-500';
      case 'xlsx':
        return 'border-emerald-200 text-emerald-600';
      case 'img':
        return 'border-gray-300 text-gray-600';
      case 'doc':
        return 'border-indigo-200 text-indigo-600';
    }
  }
}
