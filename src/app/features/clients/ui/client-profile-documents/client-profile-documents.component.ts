import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PermissionService } from '@core/auth/permission.service';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { ClientDocumentsStore } from '../../data-access/client-documents.store';
import { ClientDocumentItem } from '../../data-access/client-documents.model';

/** Permisos de CloudStorage (BuildingBlocks.Authorization.CloudStoragePermissions). */
const FILE_VIEW = 'cloudstorage.file.view';
const FILE_UPLOAD = 'cloudstorage.file.upload';
const FILE_DOWNLOAD = 'cloudstorage.file.download';
const FILE_DELETE = 'cloudstorage.file.delete';

/**
 * Pestaña "Documents" del perfil de cliente, cableada contra CloudStorage
 * (`GET /storage/files?ownerType=Customer&ownerId={clientId}`). Lista REAL y por cliente
 * (el filtro por dueño es de staff), con subida presignada, descarga y borrado. Antes esta
 * pestaña declaraba la limitación "no se puede listar por cliente"; ese filtro ya existe en el
 * backend (agregado 2026-07-20), así que ahora muestra los documentos reales del cliente.
 *
 * Nota de alcance: son los archivos archivados CONTRA el cliente (`OwnerType=Customer`). Los
 * documentos GENERADOS por el sistema (facturas, recibos) se archivan bajo otro `OwnerType`
 * (Invoice/Onboarding) y viven en sus pestañas — no se mezclan aquí.
 */
@Component({
  selector: 'app-client-profile-documents',
  imports: [CommonModule, ConfirmDialogComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-documents.component.html',
  styleUrl: './client-profile-documents.component.css',
})
export class ClientProfileDocumentsComponent implements OnChanges {
  @Input() clientId = '';
  @Input() clientName = '';

  readonly store = inject(ClientDocumentsStore);
  private readonly perms = inject(PermissionService);

  readonly canView = computed(() => this.perms.has(FILE_VIEW));
  readonly canUpload = computed(() => this.perms.has(FILE_UPLOAD));
  readonly canDownload = computed(() => this.perms.has(FILE_DOWNLOAD));
  readonly canDelete = computed(() => this.perms.has(FILE_DELETE));

  readonly isDragging = signal(false);
  readonly pendingDelete = signal<ClientDocumentItem | null>(null);
  readonly pendingDeleteMessage = computed(() => {
    const doc = this.pendingDelete();
    return doc ? `"${doc.name}" will be moved to the recycle bin.` : '';
  });

  ngOnChanges(): void {
    if (this.clientId) {
      this.store.load(this.clientId);
    }
  }

  retry(): void {
    this.store.refresh();
  }

  // ---------- Subida ----------

  onFilePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.store.uploadFiles(input.files);
      input.value = '';
    }
  }

  onDragOver(event: DragEvent): void {
    if (!this.canUpload()) {
      return;
    }
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    if (!this.canUpload()) {
      return;
    }
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.store.uploadFiles(files);
    }
  }

  // ---------- Acciones de fila ----------

  download(doc: ClientDocumentItem): void {
    this.store.download(doc);
  }

  requestDelete(doc: ClientDocumentItem): void {
    this.pendingDelete.set(doc);
  }

  confirmDelete(): void {
    const doc = this.pendingDelete();
    if (doc) {
      this.store.remove(doc);
    }
    this.pendingDelete.set(null);
  }

  statusChipClass(status: ClientDocumentItem['status']): string {
    switch (status) {
      case 'ready':
        return 'border-emerald-200 bg-emerald-50 text-emerald-600';
      case 'processing':
      case 'uploading':
        return 'border-amber-200 bg-amber-50 text-amber-600';
      case 'blocked':
        return 'border-red-200 bg-red-50 text-red-500';
    }
  }

  statusLabel(status: ClientDocumentItem['status']): string {
    switch (status) {
      case 'ready':
        return 'Ready';
      case 'processing':
        return 'Scanning…';
      case 'uploading':
        return 'Uploading…';
      case 'blocked':
        return 'Blocked';
    }
  }

  iconTint(kind: ClientDocumentItem['kind']): string {
    switch (kind) {
      case 'xlsx':
        return 'bg-emerald-50 text-emerald-600';
      case 'img':
        return 'bg-indigo-50 text-indigo-500';
      case 'doc':
        return 'bg-sky-50 text-sky-600';
      case 'pdf':
      default:
        return 'bg-red-50 text-red-500';
    }
  }

  trackById(_index: number, doc: ClientDocumentItem): string {
    return doc.id;
  }
}
