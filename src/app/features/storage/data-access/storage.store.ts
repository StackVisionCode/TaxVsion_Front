import { Injectable, computed, inject, signal } from '@angular/core';
import { EMPTY, Observable, catchError, expand, forkJoin, map, of, reduce, switchMap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { FileResponse } from '@core/cloud-storage/cloud-storage.model';
import { StorageService } from './storage.service';
import {
  CATEGORY_META,
  RecycleBinEntry,
  STORAGE_CATEGORIES,
  ShareLinkResponse,
  SharedWithMeItem,
  SharerSummary,
  StorageCategory,
  StorageGroup,
  StorageUsageResponse,
  avatarColorFor,
  categoryFromFileName,
  formatLastUpdate,
  iconForFileName,
  initialsOf,
} from './storage.model';

/** El backend clampa take a 1..100; se pagina acumulando hasta un tope acotado. */
const PAGE_SIZE = 100;
/** Máx. 500 archivos muestreados para el desglose por categoría (el resto va a "Others" vía usedBytes). */
const FILES_MAX_PAGES = 5;
/** Máx. 300 shares — más que suficiente para la tabla; se pagina client-side sobre el acumulado. */
const SHARES_MAX_PAGES = 3;

/** Permisos de link que incluyen descarga (View/Preview no — se respeta la intención del que compartió). */
const DOWNLOAD_PERMISSIONS: ReadonlySet<string> = new Set(['Download', 'Upload', 'EditMetadata']);

interface CategoryBucket {
  count: number;
  bytes: number;
  lastIso: string | null;
}

/**
 * Store del feature Storage (CloudStorage.Api vía /storage + resolución de
 * nombres vía /auth/users/{id}). providedIn: 'root', signals — mismo patrón
 * que DocumentsStore. Tres cargas independientes con loading/error propios:
 * uso/cuota, desglose por categoría y shared-with-me.
 */
@Injectable({ providedIn: 'root' })
export class StorageStore {
  private readonly service = inject(StorageService);
  private readonly cloudStorage = inject(CloudStorageUploadService);

  // ---------- Uso / cuota ----------
  private readonly _usage = signal<StorageUsageResponse | null>(null);
  private readonly _usageLoading = signal(false);
  private readonly _usageError = signal<string | null>(null);

  readonly usage = this._usage.asReadonly();
  readonly usageLoading = this._usageLoading.asReadonly();
  readonly usageError = this._usageError.asReadonly();

  /** Total del donut = cuota real del plan (0 mientras no cargó — el card no se muestra en ese caso). */
  readonly totalBytes = computed(() => this._usage()?.maxBytes ?? 0);

  // ---------- Desglose por categoría ----------
  private readonly _files = signal<FileResponse[]>([]);
  /** null = papelera no disponible (sin permiso recyclebin.manage o error) → el grupo Trash se omite. */
  private readonly _trash = signal<RecycleBinEntry[] | null>(null);
  private readonly _groupsLoading = signal(false);
  private readonly _groupsError = signal<string | null>(null);

  readonly groupsLoading = this._groupsLoading.asReadonly();
  readonly groupsError = this._groupsError.asReadonly();

  /**
   * Grupos del donut/tarjetas, computados client-side: GET /storage/usage no
   * trae desglose por categoría, así que se clasifica por extensión el listado
   * de GET /storage/files (muestra de hasta 500) + GET /storage/recycle-bin
   * como "Trash". Si la muestra no cubre todo `usedBytes`, la diferencia se
   * suma a "Others" para que el donut cierre contra la cuota real.
   */
  readonly groups = computed<StorageGroup[]>(() => {
    const buckets = new Map<StorageCategory, CategoryBucket>();
    for (const category of STORAGE_CATEGORIES) {
      buckets.set(category, { count: 0, bytes: 0, lastIso: null });
    }
    for (const file of this._files()) {
      const bucket = buckets.get(categoryFromFileName(file.originalName))!;
      bucket.count += 1;
      bucket.bytes += file.sizeBytes;
      if (!bucket.lastIso || file.createdAtUtc > bucket.lastIso) {
        bucket.lastIso = file.createdAtUtc;
      }
    }

    const trashEntries = this._trash();
    const trashBucket: CategoryBucket | null = trashEntries
      ? trashEntries.reduce<CategoryBucket>(
          (acc, entry) => ({
            count: acc.count + 1,
            bytes: acc.bytes + entry.sizeBytes,
            lastIso: !acc.lastIso || entry.softDeletedAtUtc > acc.lastIso ? entry.softDeletedAtUtc : acc.lastIso,
          }),
          { count: 0, bytes: 0, lastIso: null },
        )
      : null;

    const scannedBytes =
      [...buckets.values()].reduce((sum, bucket) => sum + bucket.bytes, 0) + (trashBucket?.bytes ?? 0);
    const usage = this._usage();
    const remainderBytes = usage ? Math.max(0, usage.usedBytes - scannedBytes) : 0;

    const groups: StorageGroup[] = STORAGE_CATEGORIES.map(category => {
      const bucket = buckets.get(category)!;
      return {
        name: category,
        icon: CATEGORY_META[category].icon,
        color: CATEGORY_META[category].color,
        fileCount: bucket.count,
        sizeBytes: bucket.bytes + (category === 'Others' ? remainderBytes : 0),
        lastUpdate: bucket.lastIso ? formatLastUpdate(bucket.lastIso) : '—',
      };
    });
    if (trashBucket) {
      groups.push({
        name: 'Trash',
        icon: CATEGORY_META['Trash'].icon,
        color: CATEGORY_META['Trash'].color,
        fileCount: trashBucket.count,
        sizeBytes: trashBucket.bytes,
        lastUpdate: trashBucket.lastIso ? formatLastUpdate(trashBucket.lastIso) : '—',
      });
    }
    return groups;
  });

  // ---------- Shared with me ----------
  private readonly _shares = signal<SharedWithMeItem[]>([]);
  private readonly _sharesLoading = signal(false);
  private readonly _sharesError = signal<string | null>(null);

  readonly shares = this._shares.asReadonly();
  readonly sharesLoading = this._sharesLoading.asReadonly();
  readonly sharesError = this._sharesError.asReadonly();

  // ---------- Descarga ----------
  private readonly _downloadingId = signal<string | null>(null);
  private readonly _downloadError = signal<string | null>(null);
  private downloadErrorTimer?: ReturnType<typeof setTimeout>;

  readonly downloadingId = this._downloadingId.asReadonly();
  readonly downloadError = this._downloadError.asReadonly();

  // ---------- Cargas ----------

  loadAll(): void {
    this.loadUsage();
    this.loadGroups();
    this.loadShares();
  }

  loadUsage(): void {
    this._usageLoading.set(true);
    this._usageError.set(null);
    this.service.getUsage().subscribe({
      next: usage => {
        this._usage.set(usage);
        this._usageLoading.set(false);
      },
      error: err => {
        this._usageError.set(toApiError(err).message);
        this._usageLoading.set(false);
      },
    });
  }

  loadGroups(): void {
    this._groupsLoading.set(true);
    this._groupsError.set(null);
    forkJoin({
      files: this.fetchPaged((skip, take) => this.service.listFiles(skip, take), FILES_MAX_PAGES),
      // La papelera exige recyclebin.manage: si falla, se omite el grupo Trash sin romper el resto.
      trash: this.service.listRecycleBin(PAGE_SIZE).pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ files, trash }) => {
        this._files.set(files);
        this._trash.set(trash);
        this._groupsLoading.set(false);
      },
      error: err => {
        this._groupsError.set(toApiError(err).message);
        this._groupsLoading.set(false);
      },
    });
  }

  loadShares(): void {
    this._sharesLoading.set(true);
    this._sharesError.set(null);
    this.fetchPaged((skip, take) => this.service.listSharedWithMe(skip, take), SHARES_MAX_PAGES)
      .pipe(switchMap(links => this.enrichShares(links)))
      .subscribe({
        next: items => {
          this._shares.set(items);
          this._sharesLoading.set(false);
        },
        error: err => {
          this._sharesError.set(toApiError(err).message);
          this._sharesLoading.set(false);
        },
      });
  }

  /**
   * Abre el archivo compartido vía POST /storage/files/{fileId}/download-url.
   * Autorizado para el destinatario porque este frontend es de staff del tenant
   * (TenantEmployee/TenantAdmin): StorageActorScope.CanAccess es true para todo
   * archivo del tenant — verificado en IssueDownloadUrlHandler.
   */
  downloadShared(item: SharedWithMeItem): void {
    if (!item.canDownload || !item.fileId || this._downloadingId()) {
      return;
    }
    this._downloadingId.set(item.shareLinkId);
    this.cloudStorage.getDownloadUrl(item.fileId).subscribe({
      next: res => {
        this._downloadingId.set(null);
        window.open(res.downloadUrl, '_blank');
      },
      error: err => {
        this._downloadingId.set(null);
        this.flashDownloadError(toApiError(err).message);
      },
    });
  }

  // ---------- Internos ----------

  /** Acumula páginas skip/take hasta una página corta o el tope de páginas. */
  private fetchPaged<T>(
    fetch: (skip: number, take: number) => Observable<T[]>,
    maxPages: number,
  ): Observable<T[]> {
    return fetch(0, PAGE_SIZE).pipe(
      expand((batch, index) =>
        batch.length === PAGE_SIZE && index + 1 < maxPages ? fetch((index + 1) * PAGE_SIZE, PAGE_SIZE) : EMPTY,
      ),
      reduce((acc, batch) => acc.concat(batch), [] as T[]),
    );
  }

  /**
   * ShareLinkResponse solo trae IDs: se resuelve la metadata del archivo
   * (GET /storage/files/{id} — accesible para staff del tenant) y el nombre de
   * quien compartió (GET /auth/users/{id} — exige users.view). Ambas son
   * best-effort: un fallo puntual degrada la fila, no rompe la tabla.
   */
  private enrichShares(links: ShareLinkResponse[]): Observable<SharedWithMeItem[]> {
    const fileIds = [...new Set(links.filter(l => l.resourceType === 'File').map(l => l.resourceId))];
    const sharerIds = [...new Set(links.map(l => l.createdByUserId))];

    const files$: Observable<(FileResponse | null)[]> = fileIds.length
      ? forkJoin(fileIds.map(id => this.cloudStorage.getFile(id).pipe(catchError(() => of(null)))))
      : of([]);
    const sharers$: Observable<(SharerSummary | null)[]> = sharerIds.length
      ? forkJoin(sharerIds.map(id => this.service.getSharer(id).pipe(catchError(() => of(null)))))
      : of([]);

    return forkJoin({ files: files$, sharers: sharers$ }).pipe(
      map(({ files, sharers }) => {
        const fileById = new Map(files.filter((f): f is FileResponse => f !== null).map(f => [f.id, f]));
        const sharerById = new Map(sharers.filter((s): s is SharerSummary => s !== null).map(s => [s.id, s]));
        return links.map(link => this.toSharedItem(link, fileById, sharerById));
      }),
    );
  }

  private toSharedItem(
    link: ShareLinkResponse,
    fileById: Map<string, FileResponse>,
    sharerById: Map<string, SharerSummary>,
  ): SharedWithMeItem {
    const isFolder = link.resourceType === 'Folder';
    const file = isFolder ? null : (fileById.get(link.resourceId) ?? null);
    const sharer = sharerById.get(link.createdByUserId) ?? null;
    const sharedByName = sharer ? `${sharer.name} ${sharer.lastName}`.trim() : 'Team member';
    return {
      shareLinkId: link.id,
      resourceType: link.resourceType,
      fileId: isFolder ? null : link.resourceId,
      name: isFolder ? 'Shared folder' : (file?.originalName ?? 'Unavailable file'),
      icon: isFolder ? 'folder-outline' : file ? iconForFileName(file.originalName) : 'document-text-outline',
      category: isFolder ? 'Folder' : file ? categoryFromFileName(file.originalName) : 'Others',
      permission: link.permission,
      status: link.status,
      sharedByName,
      sharedByInitials: sharer ? initialsOf(sharedByName) : '?',
      sharedByColor: avatarColorFor(link.createdByUserId),
      sharedAtUtc: link.createdAtUtc,
      sizeBytes: file?.sizeBytes ?? null,
      canDownload:
        !isFolder &&
        file !== null &&
        file.status === 'Available' &&
        link.status === 'Active' &&
        DOWNLOAD_PERMISSIONS.has(link.permission),
    };
  }

  private flashDownloadError(message: string): void {
    this._downloadError.set(message);
    clearTimeout(this.downloadErrorTimer);
    this.downloadErrorTimer = setTimeout(() => this._downloadError.set(null), 4000);
  }
}
