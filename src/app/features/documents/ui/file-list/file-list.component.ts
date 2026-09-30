import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, inject } from '@angular/core';
import { detectViewerKind } from '@shared/ui/index';
import {
  FileResponse,
  FolderResponse,
  displayStatus,
  formatBytes,
  formatDate,
  isFileReady,
  kindFromFileName,
} from '../../data-access/documents.model';
import { DocumentsPermissions } from '../../data-access/documents-permissions';

/** Acción emitida por una fila; la página (contenedor smart) la ejecuta contra el store. */
export type FileRowAction =
  | { kind: 'open-folder'; folder: FolderResponse }
  | { kind: 'rename-folder'; folder: FolderResponse }
  | { kind: 'move-folder'; folder: FolderResponse }
  | { kind: 'share-folder'; folder: FolderResponse }
  | { kind: 'delete-folder'; folder: FolderResponse }
  | { kind: 'select-file'; file: FileResponse }
  | { kind: 'toggle-file'; file: FileResponse }
  | { kind: 'preview-file'; file: FileResponse }
  | { kind: 'download-file'; file: FileResponse }
  | { kind: 'share-file'; file: FileResponse }
  | { kind: 'move-file'; file: FileResponse }
  | { kind: 'delete-file'; file: FileResponse };

/** Icono ion por tipo de archivo (según extensión, más fiel a lo que ve el usuario). */
const KIND_ICON: Record<string, string> = {
  pdf: 'document-text-outline',
  xlsx: 'grid-outline',
  img: 'image-outline',
  doc: 'document-outline',
};

/**
 * Lista de archivos y carpetas (vista principal). Presentacional: recibe filas y
 * emite acciones. Estado de escaneo mostrado "amable" (Ready/Processing/Blocked).
 */
@Component({
  selector: 'app-file-list',
  imports: [],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './file-list.component.html',
  styleUrl: './file-list.component.css',
})
export class FileListComponent {
  /**
   * B6 — las acciones de fila se gatean acá y no por `@Input`: son ocho botones en dos vistas y
   * pasarlas una por una desde la página solo multiplica los sitios donde olvidarse de una.
   */
  protected readonly can = inject(DocumentsPermissions);

  @Input() subfolders: FolderResponse[] = [];
  @Input() files: FileResponse[] = [];
  @Input() loading = false;
  @Input() selectedFileId: string | null = null;
  @Input() selectedIds: ReadonlySet<string> = new Set();
  @Input() view: 'list' | 'grid' = 'list';
  @Output() action = new EventEmitter<FileRowAction>();
  @Output() toggleAll = new EventEmitter<void>();
  @Output() setSort = new EventEmitter<'name' | 'modified' | 'size'>();

  readonly skeletonRows = [0, 1, 2, 3, 4];

  extOf(name: string): string {
    return (name.split('.').pop() ?? '').toUpperCase();
  }

  /** Lo que el visor global sabe renderizar (PDF, imágenes, texto y CSV). */
  previewable(file: FileResponse): boolean {
    return detectViewerKind(file.originalName, file.detectedContentType ?? file.declaredContentType) !== 'unsupported';
  }

  get isEmpty(): boolean {
    return !this.loading && this.subfolders.length === 0 && this.files.length === 0;
  }

  isSelected(file: FileResponse): boolean {
    return this.selectedIds.has(file.id);
  }

  get allSelected(): boolean {
    return this.files.length > 0 && this.files.every(f => this.selectedIds.has(f.id));
  }

  get someSelected(): boolean {
    return this.files.some(f => this.selectedIds.has(f.id)) && !this.allSelected;
  }

  fileIcon(name: string): string {
    return KIND_ICON[kindFromFileName(name)] ?? 'document-outline';
  }

  status(file: FileResponse): string {
    return displayStatus(file.status);
  }

  ready(file: FileResponse): boolean {
    return isFileReady(file.status);
  }

  size(file: FileResponse): string {
    return formatBytes(file.sizeBytes);
  }

  modified(file: FileResponse): string {
    return formatDate(file.scannedAtUtc ?? file.createdAtUtc);
  }

  formatCreated(iso: string): string {
    return formatDate(iso);
  }

  /** Carpeta del sistema (Documents, Email, Signed Documents…): no se puede renombrar/mover/borrar. */
  isSystemFolder(folder: FolderResponse): boolean {
    return !!folder.category?.startsWith('sys.');
  }
}
