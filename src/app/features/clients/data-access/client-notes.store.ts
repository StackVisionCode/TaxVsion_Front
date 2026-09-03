import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, switchMap, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { InitiateUploadRequest } from '@core/cloud-storage/cloud-storage.model';
import { ClientNotesService } from './client-notes.service';
import {
  ClientNoteCard,
  CLIENT_NOTE_TARGET_TYPE,
  NoteColorKind,
  NoteResponse,
  NoteVisibility,
  toClientNoteCard,
} from './client-notes.model';

/** Cuántas veces se recarga la lista tras adjuntar, buscando el flip Pending→Available (scan async). */
const ATTACH_POLLS = 6;
const ATTACH_POLL_INTERVAL_MS = 3000;

/** Permiso de gobernanza de Notes: habilita archivar/restaurar/borrar notas ajenas (nunca editarlas). */
const NOTES_VIEW_ALL = 'notes.view_all';

/**
 * Store de la pestaña "Notes" del perfil de cliente (Notes.Api vía `/notes`).
 *
 * `providedIn: 'root'` con estado por cliente: la pestaña se destruye y se recrea al
 * cambiar de tab (`*ngSwitchCase`), así que `load(clientId)` limpia el estado cuando el
 * cliente cambia y siempre pide datos frescos.
 *
 * Reparto de errores igual que en Task: `error` es el fallo del listado (con Retry) y
 * `actionError` es el banner descartable de una acción suelta (pin, color, archivar…);
 * los flujos de formulario (alta/edición) devuelven el Observable para que el componente
 * muestre el error junto al editor.
 */
@Injectable({ providedIn: 'root' })
export class ClientNotesStore {
  private readonly service = inject(ClientNotesService);
  private readonly auth = inject(AuthService);
  private readonly cloud = inject(CloudStorageUploadService);

  private clientId = '';
  private userNamesLoaded = false;

  private readonly _raw = signal<NoteResponse[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _actionError = signal<string | null>(null);
  private readonly _busyIds = signal<ReadonlySet<string>>(new Set());
  private readonly _userNames = signal<ReadonlyMap<string, string>>(new Map());
  /** Ids de notas creadas en esta sesión: propias con certeza, aunque `currentUser()` tarde. */
  private readonly _optimisticMineIds = signal<ReadonlySet<string>>(new Set());

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly actionError = this._actionError.asReadonly();

  /** Autor + `notes.view_all` salen de /auth/me, que el initializer ya resolvió al arrancar. */
  private readonly currentUserId = computed(() => this.auth.currentUser()?.id ?? null);
  private readonly hasViewAll = computed(() => this.auth.currentUser()?.permissions?.includes(NOTES_VIEW_ALL) ?? false);

  readonly notes = computed<ClientNoteCard[]>(() => {
    const names = this._userNames();
    const me = this.currentUserId();
    const viewAll = this.hasViewAll();
    const mine = this._optimisticMineIds();
    return this._raw().map(note => toClientNoteCard(note, names, me, viewAll, mine.has(note.id)));
  });

  readonly total = computed(() => this._raw().length);

  isBusy(id: string): boolean {
    return this._busyIds().has(id);
  }

  clearActionError(): void {
    this._actionError.set(null);
  }

  /** Carga (o recarga) las notas del cliente indicado. */
  load(clientId: string): void {
    if (clientId !== this.clientId) {
      this.clientId = clientId;
      this._raw.set([]);
      this._actionError.set(null);
    }
    this.loadUserNamesOnce();
    this.refresh();
  }

  refresh(): void {
    if (!this.clientId) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    this.service.listByClient(this.clientId).subscribe({
      next: result => {
        this._raw.set(result.items);
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  // ---------- Alta / edición (el componente muestra el error junto al editor) ----------

  create(html: string, visibility: NoteVisibility, colorKind: NoteColorKind): Observable<void> {
    return this.service
      .create({
        html,
        targetType: CLIENT_NOTE_TARGET_TYPE,
        targetId: this.clientId,
        visibility,
        // `Default` equivale a "sin color": se manda null para no persistir un color inútil.
        colorKind: colorKind === 'Default' ? null : colorKind,
      })
      .pipe(
        tap(created => {
          this._optimisticMineIds.update(ids => new Set(ids).add(created.id));
          this._raw.update(list => [created, ...list]);
        }),
        map(() => undefined),
      );
  }

  updateContent(id: string, html: string): Observable<void> {
    return this.service.updateContent(id, { html }).pipe(
      tap(updated => this.replace(updated)),
      map(() => undefined),
    );
  }

  // ---------- Acciones sueltas (banner descartable) ----------

  setVisibility(id: string, visibility: NoteVisibility): void {
    this.runAction(id, this.service.changeVisibility(id, { visibility }));
  }

  togglePin(note: ClientNoteCard): void {
    this.runAction(note.id, note.isPinned ? this.service.unpin(note.id) : this.service.pin(note.id));
  }

  setColor(id: string, colorKind: NoteColorKind): void {
    this.runAction(id, this.service.setColor(id, colorKind === 'Default' ? null : colorKind));
  }

  /** Archivar es reversible (`Active ⇄ Archived`); la nota archivada sigue listándose, marcada. */
  toggleArchive(note: ClientNoteCard): void {
    this.runAction(note.id, note.isArchived ? this.service.restore(note.id) : this.service.archive(note.id));
  }

  /** DELETE /notes/{id} — borrado lógico: responde 204 y la nota desaparece del listado. */
  remove(id: string): void {
    this.markBusy(id, true);
    this.service.remove(id).subscribe({
      next: () => {
        this._raw.update(list => list.filter(note => note.id !== id));
        this.markBusy(id, false);
      },
      error: err => {
        this._actionError.set(toApiError(err).message);
        this.markBusy(id, false);
      },
    });
  }

  // ---------- Adjuntos (solo el autor) ----------

  /**
   * Sube el archivo a CloudStorage (presigned) y lo enlaza a la nota. El adjunto queda `Pending`
   * hasta que el escaneo lo marca `Available` (evento async) — se sondea la lista para reflejarlo.
   * OwnerType=Customer/OwnerId=cliente para co-ubicarlo; la nota se enlaza por `fileId`.
   */
  attachFile(noteId: string, file: File): void {
    this.markBusy(noteId, true);
    const contentType = file.type || 'application/octet-stream';
    const request: InitiateUploadRequest = {
      originalName: file.name,
      contentType,
      sizeBytes: file.size,
      ownerType: 'Customer',
      ownerId: this.clientId,
      // `Other`: un adjunto de nota NO es un documento fiscal, así que no exige tax year
      // (los buckets Documents/Receipts/Invoices sí lo piden — FolderTypeRules.RequiresYear).
      folderType: 'Other',
      taxYear: null,
    };
    this.cloud
      .initiateUpload(request)
      .pipe(
        switchMap(initiated =>
          this.cloud.uploadToPresignedUrl(initiated.uploadUrl, initiated.formData, file).pipe(
            // Se crea el link (attach → NoteAttachment en Pending) ANTES de `complete`. `complete`
            // dispara el escaneo → `cloudstorage.file.available` → el consumer de Notes busca la fila
            // por CloudStorageFileId para marcarla Available. Si `complete` fuera primero, ese evento
            // podía llegar (~100ms) antes de que la fila existiera y el adjunto quedaba atascado en
            // "Scanning". Con attach primero la fila ya está cuando el evento llega (Notes no tiene
            // client de CloudStorage para auto-sanarse en lectura, así que el orden es la garantía).
            switchMap(() =>
              this.service.attach(noteId, {
                cloudStorageFileId: initiated.fileId,
                displayName: file.name,
                contentType,
                sizeBytes: file.size,
              }),
            ),
            switchMap(updated => this.cloud.completeUpload(initiated.fileId).pipe(map(() => updated))),
          ),
        ),
      )
      .subscribe({
        next: updated => {
          this.replace(updated);
          this.markBusy(noteId, false);
          this.pollAttachments(ATTACH_POLLS);
        },
        error: err => {
          this._actionError.set(toApiError(err).message);
          this.markBusy(noteId, false);
        },
      });
  }

  /** DELETE del adjunto (204) + recarga para reflejar el cambio. */
  detachAttachment(noteId: string, fileId: string): void {
    this.markBusy(noteId, true);
    this.service.detach(noteId, fileId).subscribe({
      next: () => {
        this.markBusy(noteId, false);
        this.refresh();
      },
      error: err => {
        this._actionError.set(toApiError(err).message);
        this.markBusy(noteId, false);
      },
    });
  }

  /** Descarga un adjunto por su fileId de CloudStorage (URL presignada). */
  downloadAttachment(fileId: string): void {
    this.cloud.getDownloadUrl(fileId).subscribe({
      next: res => this.triggerDownload(res.downloadUrl),
      error: err => this._actionError.set(toApiError(err).message),
    });
  }

  private pollAttachments(attemptsLeft: number): void {
    if (attemptsLeft <= 0 || !this.clientId) {
      return;
    }
    const hasPending = this._raw().some(note => note.attachments.some(a => a.status === 'Pending'));
    if (!hasPending) {
      return;
    }
    setTimeout(() => {
      this.service.listByClient(this.clientId).subscribe({
        next: result => {
          this._raw.set(result.items);
          this.pollAttachments(attemptsLeft - 1);
        },
        error: () => {
          // Best-effort: si un poll falla, se deja de intentar.
        },
      });
    }, ATTACH_POLL_INTERVAL_MS);
  }

  private triggerDownload(url: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  // ---------- Internos ----------

  private runAction(id: string, action: Observable<NoteResponse>): void {
    this.markBusy(id, true);
    action.subscribe({
      next: updated => {
        this.replace(updated);
        this.markBusy(id, false);
      },
      error: err => {
        this._actionError.set(toApiError(err).message);
        this.markBusy(id, false);
      },
    });
  }

  private replace(updated: NoteResponse): void {
    this._raw.update(list => list.map(note => (note.id === updated.id ? updated : note)));
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

  /**
   * Nombres de autores: el usuario logueado (siempre disponible) + GET /auth/users
   * best-effort. Sin `users.view` el listado responde 403 y las notas ajenas quedan como
   * "Team member" — no hay otra fuente de nombres en el contrato de Notes.
   */
  private loadUserNamesOnce(): void {
    if (this.userNamesLoaded) {
      return;
    }
    this.userNamesLoaded = true;

    const me = this.auth.currentUser();
    if (me) {
      this.mergeUserNames([[me.id, `${me.name} ${me.lastName}`.trim()]]);
    }

    this.service.listUsers().subscribe({
      next: result => this.mergeUserNames(result.items.map(user => [user.id, `${user.name} ${user.lastName}`.trim()])),
      error: err =>
        console.warn('Client notes: no se pudieron resolver nombres de autores:', toApiError(err).message),
    });
  }

  private mergeUserNames(entries: Array<[string, string]>): void {
    if (entries.length === 0) {
      return;
    }
    this._userNames.update(current => {
      const next = new Map(current);
      for (const [id, name] of entries) {
        if (name) {
          next.set(id, name);
        }
      }
      return next;
    });
  }
}
