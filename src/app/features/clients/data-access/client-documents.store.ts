import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, Subject, catchError, map, of, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { toApiError } from '@core/models/api-error.model';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { FileResponse, InitiateUploadRequest, isFilePending } from '@core/cloud-storage/cloud-storage.model';
import { ClientDocumentsService } from './client-documents.service';
import {
  ClientDocumentItem,
  ClientFolderContents,
  ClientFolderCrumb,
  ClientFolderItem,
  ClientFolderResponse,
  toClientDocumentItem,
  toClientFolderItem,
  trimPath,
} from './client-documents.model';

/** Tope de una página del listado de carpeta (el backend acota `take`). */
const FETCH_SIZE = 100;
const MAX_STATUS_POLLS = 8;
const STATUS_POLL_INTERVAL_MS = 3000;
/** Volver a la pestaña dentro de este tiempo no repite el listado. */
const FRESH_MS = 60_000;

/**
 * Store de la pestaña "Documents" del perfil, con NAVEGACIÓN POR CARPETAS del cliente.
 *
 * Antes era un feed plano (`GET /storage/files?ownerType=Customer&ownerId=`, todo en la raíz del
 * bucket `Documents`). Ahora navega el árbol real del cliente con `GET /storage/folders`
 * (`ownerType=Customer&ownerId=` + `parentFolderId`), un nivel por vez: subcarpetas + archivos,
 * breadcrumbs, crear y renombrar carpetas. La subida deja el archivo en la carpeta ABIERTA
 * (initiate → MinIO → complete → `PUT files/{id}/folder`), igual que el módulo Documents.
 *
 * Cada navegación entra por un `Subject` con `switchMap`: abrir carpetas rápido cancela el
 * listado anterior y nunca pinta una respuesta vieja sobre la carpeta nueva.
 */
@Injectable({ providedIn: 'root' })
export class ClientDocumentsStore {
  private readonly cloud = inject(CloudStorageUploadService);
  private readonly local = inject(ClientDocumentsService);
  private readonly toast = inject(ToastService);

  private customerId = '';
  private loadedAt = 0;

  private readonly _path = signal<ClientFolderCrumb[]>([]);
  private readonly _folders = signal<ClientFolderResponse[]>([]);
  private readonly _files = signal<FileResponse[]>([]);
  private readonly _totalCount = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _uploadingCount = signal(0);
  private readonly _busyIds = signal<ReadonlySet<string>>(new Set());
  private readonly _savingFolder = signal(false);

  readonly path = this._path.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly savingFolder = this._savingFolder.asReadonly();
  readonly busyIds = this._busyIds.asReadonly();
  readonly uploading = computed(() => this._uploadingCount() > 0);

  readonly currentFolderId = computed(() => this._path().at(-1)?.id ?? null);
  readonly folders = computed<ClientFolderItem[]>(() => this._folders().map(toClientFolderItem));
  readonly documents = computed<ClientDocumentItem[]>(() => this._files().map(toClientDocumentItem));
  readonly total = computed(() => this._folders().length + this._files().length);
  readonly readyCount = computed(() => this._files().filter(f => f.status === 'Available').length);
  /** Hay más elementos en esta carpeta de los que caben en una página. */
  readonly maybeTruncated = computed(() => this._totalCount() > this.total());

  private readonly load$ = new Subject<{ customerId: string; folderId: string | null }>();

  constructor() {
    this.load$
      .pipe(
        tap(() => {
          this._loading.set(true);
          this._error.set(null);
        }),
        switchMap(({ customerId, folderId }) =>
          this.local.getFolderContents(customerId, folderId, FETCH_SIZE).pipe(
            catchError(err => {
              this._error.set(toApiError(err).message);
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((contents: ClientFolderContents | null) => {
        this._loading.set(false);
        if (!contents) {
          this.loadedAt = 0;
          return;
        }
        this._folders.set(contents.subfolders ?? []);
        this._files.set(contents.files ?? []);
        this._totalCount.set(contents.totalCount ?? (contents.subfolders?.length ?? 0) + (contents.files?.length ?? 0));
        this.loadedAt = Date.now();
      });
  }

  isBusy(id: string): boolean {
    return this._busyIds().has(id);
  }

  /**
   * Al montar la pestaña. Cambiar de cliente vuelve a la raíz; volver al mismo cliente conserva la
   * carpeta abierta y no repite el listado si está fresco.
   */
  load(customerId: string): void {
    if (customerId !== this.customerId) {
      this.customerId = customerId;
      this._path.set([]);
      this._folders.set([]);
      this._files.set([]);
      this._totalCount.set(0);
      this.loadedAt = 0;
    }
    if (Date.now() - this.loadedAt > FRESH_MS) {
      this.refresh();
    }
  }

  /** Recarga forzada de la carpeta abierta (botón y tras mutaciones). */
  refresh(): void {
    if (this.customerId) {
      this.load$.next({ customerId: this.customerId, folderId: this.currentFolderId() });
    }
  }

  // ---------- Navegación ----------

  openFolder(folder: ClientFolderItem): void {
    this._path.update(path => [...path, { id: folder.id, name: folder.name }]);
    this.clearListing();
    this.refresh();
  }

  /** Ir a un escalón del breadcrumb (-1 = raíz "All documents"). */
  goToCrumb(index: number): void {
    const next = trimPath(this._path(), index);
    if (next.length === this._path().length) {
      return;
    }
    this._path.set(next);
    this.clearListing();
    this.refresh();
  }

  private clearListing(): void {
    this._folders.set([]);
    this._files.set([]);
    this._totalCount.set(0);
  }

  // ---------- Carpetas ----------

  /** Crea una carpeta dentro de la abierta. Devuelve true si salió (el modal se cierra). */
  createFolder(name: string): Observable<boolean> {
    if (!this.customerId) {
      return of(false);
    }
    this._savingFolder.set(true);
    return this.local.createFolder(this.customerId, this.currentFolderId(), name.trim()).pipe(
      map(() => {
        this._savingFolder.set(false);
        this.toast.success(`Folder "${name.trim()}" created`);
        this.refresh();
        return true;
      }),
      catchError(err => {
        this._savingFolder.set(false);
        this.toast.error(toApiError(err).message);
        return of(false);
      }),
    );
  }

  renameFolder(folderId: string, newName: string): Observable<boolean> {
    this._savingFolder.set(true);
    return this.local.renameFolder(folderId, newName.trim()).pipe(
      map(() => {
        this._savingFolder.set(false);
        // El breadcrumb también puede mostrar esa carpeta.
        this._path.update(path => path.map(c => (c.id === folderId ? { ...c, name: newName.trim() } : c)));
        this._folders.update(list => list.map(f => (f.id === folderId ? { ...f, name: newName.trim() } : f)));
        this.toast.success('Folder renamed');
        return true;
      }),
      catchError(err => {
        this._savingFolder.set(false);
        this.toast.error(toApiError(err).message);
        return of(false);
      }),
    );
  }

  // ---------- Subida (presigned POST: initiate → MinIO → complete → carpeta) ----------

  uploadFiles(fileList: FileList | File[]): void {
    const files = Array.from(fileList);
    if (files.length === 0 || !this.customerId) {
      return;
    }
    this.toast.info(files.length === 1 ? 'Uploading 1 file' : `Uploading ${files.length} files`);
    const folderId = this.currentFolderId();
    files.forEach(file => this.uploadOne(file, folderId));
  }

  private uploadOne(file: File, folderId: string | null): void {
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
            switchMap(() => (folderId ? this.local.moveFileToFolder(initiated.fileId, folderId) : of(undefined))),
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
          this._files.update(list => list.map(f => (f.id === file.id ? file : f)));
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

  // ---------- Descargar / previsualizar ----------

  download(item: ClientDocumentItem): void {
    this.withDownloadUrl(item, url => this.triggerDownload(url));
  }

  /** URL presignada de lectura, pedida recién al mostrar el archivo en el visor (vencen en minutos). */
  downloadUrl(item: ClientDocumentItem): Observable<string> {
    return this.cloud.getDownloadUrl(item.id).pipe(map(res => res.downloadUrl));
  }

  private withDownloadUrl(item: ClientDocumentItem, use: (url: string) => void): void {
    if (!item.isReady) {
      return;
    }
    this.markBusy(item.id, true);
    this.cloud.getDownloadUrl(item.id).subscribe({
      next: res => {
        use(res.downloadUrl);
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
        this._files.update(list => list.filter(f => f.id !== item.id));
        this._totalCount.update(n => Math.max(0, n - 1));
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
