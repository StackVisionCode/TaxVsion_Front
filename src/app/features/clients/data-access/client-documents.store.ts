import { Injectable, computed, inject, signal } from '@angular/core';
import { map, of, switchMap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { FileResponse, InitiateUploadRequest, isFilePending } from '@core/cloud-storage/cloud-storage.model';
import { ClientDocumentsService } from './client-documents.service';
import { ClientDocumentItem, toClientDocumentItem } from './client-documents.model';

/** El backend acota `take` a 100; es el tope de un cliente en esta vista plana. */
const FETCH_SIZE = 100;
const MAX_STATUS_POLLS = 8;
const STATUS_POLL_INTERVAL_MS = 3000;

/**
 * Store de la pestaña "Documents" del perfil (CloudStorage vía `/storage/files?ownerType=Customer&ownerId=`).
 *
 * Listado REAL y por cliente (el filtro `ownerType`/`ownerId` es de staff — un actor de portal se
 * acota solo a lo suyo). Reutiliza el core `CloudStorageUploadService` para list/upload/download y
 * el complemento local para el borrado. `providedIn: 'root'` con estado por cliente: `load(id)`
 * limpia si cambió el cliente. Subir/borrar refrescan en background (nunca recarga de página);
 * el estado de un archivo recién subido se sondea (Processing→Ready) sin recargar.
 */
@Injectable({ providedIn: 'root' })
export class ClientDocumentsStore {
  private readonly cloud = inject(CloudStorageUploadService);
  private readonly local = inject(ClientDocumentsService);
  private readonly toast = inject(ToastService);

  private customerId = '';

  private readonly _raw = signal<FileResponse[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _uploadingCount = signal(0);
  private readonly _busyIds = signal<ReadonlySet<string>>(new Set());

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly uploading = computed(() => this._uploadingCount() > 0);

  readonly documents = computed<ClientDocumentItem[]>(() => this._raw().map(toClientDocumentItem));
  readonly total = computed(() => this._raw().length);
  readonly readyCount = computed(() => this._raw().filter(f => f.status === 'Available').length);
  /** El listado va topado a 100: si llega justo el tope, puede haber más y la vista lo declara. */
  readonly maybeTruncated = computed(() => this._raw().length >= FETCH_SIZE);

  isBusy(id: string): boolean {
    return this._busyIds().has(id);
  }

  load(customerId: string): void {
    if (customerId !== this.customerId) {
      this.customerId = customerId;
      this._raw.set([]);
    }
    this.refresh();
  }

  refresh(): void {
    if (!this.customerId) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    this.cloud.listFiles(0, FETCH_SIZE, 'Customer', this.customerId).subscribe({
      next: files => {
        this._raw.set(files);
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  // ---------- Subida (presigned POST: initiate → MinIO → complete) ----------

  uploadFiles(fileList: FileList | File[]): void {
    const files = Array.from(fileList);
    if (files.length === 0 || !this.customerId) {
      return;
    }
    this.toast.info(files.length === 1 ? 'Uploading 1 file' : `Uploading ${files.length} files`);
    files.forEach(file => this.uploadOne(file));
  }

  private uploadOne(file: File): void {
    const request: InitiateUploadRequest = {
      originalName: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      ownerType: 'Customer',
      ownerId: this.customerId,
      // El bucket `Documents` exige tax year (FolderTypeRules.RequiresYear); se usa el año actual,
      // igual que el módulo de oficina, para que la subida no falle con File.YearRequired.
      folderType: 'Documents',
      taxYear: new Date().getFullYear(),
    };

    this._uploadingCount.update(n => n + 1);
    this.cloud
      .initiateUpload(request)
      .pipe(
        switchMap(initiated =>
          this.cloud.uploadToPresignedUrl(initiated.uploadUrl, initiated.formData, file).pipe(
            switchMap(() => this.cloud.completeUpload(initiated.fileId)),
            map(() => initiated.fileId),
          ),
        ),
      )
      .subscribe({
        next: fileId => {
          this._uploadingCount.update(n => n - 1);
          this.refresh();
          this.pollFileStatus(fileId, MAX_STATUS_POLLS);
        },
        error: err => {
          this._uploadingCount.update(n => n - 1);
          this.toast.error(toApiError(err).message);
        },
      });
  }

  private pollFileStatus(fileId: string, attemptsLeft: number): void {
    if (attemptsLeft <= 0) {
      return;
    }
    setTimeout(() => {
      this.cloud.getFile(fileId).subscribe({
        next: file => {
          this._raw.update(list => list.map(f => (f.id === file.id ? file : f)));
          if (isFilePending(file.status)) {
            this.pollFileStatus(fileId, attemptsLeft - 1);
          } else if (file.status === 'Available') {
            this.toast.success(`${file.originalName} is ready`);
          }
        },
        // Best-effort: si una consulta de poll falla, se deja de intentar en silencio.
        error: () => {},
      });
    }, STATUS_POLL_INTERVAL_MS);
  }

  // ---------- Descargar ----------

  download(item: ClientDocumentItem): void {
    if (!item.isReady) {
      return;
    }
    this.markBusy(item.id, true);
    this.cloud.getDownloadUrl(item.id).subscribe({
      next: res => {
        this.triggerDownload(res.downloadUrl);
        this.markBusy(item.id, false);
      },
      error: err => {
        this.markBusy(item.id, false);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  private triggerDownload(url: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  // ---------- Borrar ----------

  remove(item: ClientDocumentItem): void {
    this.markBusy(item.id, true);
    this.local.deleteFile(item.id).subscribe({
      next: () => {
        this._raw.update(list => list.filter(f => f.id !== item.id));
        this.markBusy(item.id, false);
        this.toast.success(`"${item.name}" moved to the recycle bin`);
      },
      error: err => {
        this.markBusy(item.id, false);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  private markBusy(id: string, busy: boolean): void {
    this._busyIds.update(current => {
      const next = new Set(current);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }
}
