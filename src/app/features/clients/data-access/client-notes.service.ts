import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { PagedResult } from './clients.model';
import {
  AttachFileToNoteRequest,
  ChangeNoteVisibilityRequest,
  CLIENT_NOTE_TARGET_TYPE,
  CreateNoteRequest,
  NoteAuthorSummary,
  NoteColorKind,
  NoteResponse,
  NOTES_PAGE_SIZE,
  SetNoteColorRequest,
  UpdateNoteContentRequest,
} from './client-notes.model';

/**
 * Cliente HTTP fino sobre `NotesController` (`/notes`, servicio Notes.Api vía Gateway).
 *
 * Todas las acciones (pin, color, archivar…) devuelven la nota completa actualizada, así
 * que el store nunca necesita recargar la lista entera después de una acción.
 */
@Injectable({ providedIn: 'root' })
export class ClientNotesService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/notes');
  }

  /**
   * GET /notes?targetType=Customer&targetId={clientId} — el ÚNICO listado filtrado por
   * cliente. Devuelve pinneadas primero y luego por `updatedAtUtc` desc, y sí incluye las
   * archivadas (el repo solo excluye `Deleted`), por eso la UI las marca aparte.
   */
  listByClient(clientId: string, page = 1, size = NOTES_PAGE_SIZE): Observable<PagedResult<NoteResponse>> {
    const params = new HttpParams()
      .set('targetType', CLIENT_NOTE_TARGET_TYPE)
      .set('targetId', clientId)
      .set('page', page)
      .set('size', size);
    return this.http.get<PagedResult<NoteResponse>>(this.base, { params });
  }

  create(req: CreateNoteRequest): Observable<NoteResponse> {
    return this.http.post<NoteResponse>(this.base, req);
  }

  /** PUT /notes/{id}/content — solo el autor; ni `notes.view_all` habilita editar contenido ajeno. */
  updateContent(id: string, req: UpdateNoteContentRequest): Observable<NoteResponse> {
    return this.http.put<NoteResponse>(`${this.base}/${id}/content`, req);
  }

  changeVisibility(id: string, req: ChangeNoteVisibilityRequest): Observable<NoteResponse> {
    return this.http.put<NoteResponse>(`${this.base}/${id}/visibility`, req);
  }

  pin(id: string): Observable<NoteResponse> {
    return this.http.post<NoteResponse>(`${this.base}/${id}/pin`, {});
  }

  unpin(id: string): Observable<NoteResponse> {
    return this.http.post<NoteResponse>(`${this.base}/${id}/unpin`, {});
  }

  /** PUT /notes/{id}/color — `colorKind: null` quita el color (el VO es opcional). */
  setColor(id: string, colorKind: NoteColorKind | null): Observable<NoteResponse> {
    const req: SetNoteColorRequest = { colorKind };
    return this.http.put<NoteResponse>(`${this.base}/${id}/color`, req);
  }

  archive(id: string): Observable<NoteResponse> {
    return this.http.post<NoteResponse>(`${this.base}/${id}/archive`, {});
  }

  restore(id: string): Observable<NoteResponse> {
    return this.http.post<NoteResponse>(`${this.base}/${id}/restore`, {});
  }

  /** DELETE /notes/{id} — borrado lógico (status `Deleted`); responde 204 y la nota deja de listarse. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  /**
   * POST /notes/{id}/attachments — enlaza un archivo YA subido a CloudStorage a la nota (perm
   * `notes.manage` + SOLO el autor). Devuelve la nota completa con el adjunto en `Pending`.
   */
  attach(noteId: string, req: AttachFileToNoteRequest): Observable<NoteResponse> {
    return this.http.post<NoteResponse>(`${this.base}/${noteId}/attachments`, req);
  }

  /** DELETE /notes/{id}/attachments/{fileId} — desvincula un adjunto (autor + `notes.manage`). */
  detach(noteId: string, cloudStorageFileId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${noteId}/attachments/${cloudStorageFileId}`);
  }

  /**
   * GET /auth/users — nombres de los autores. Best-effort exactamente igual que en Task:
   * `NoteResponse` solo trae `createdByUserId` y sin el permiso `users.view` esto devuelve
   * 403, en cuyo caso las tarjetas caen a "Team member".
   */
  listUsers(size = 200): Observable<PagedResult<NoteAuthorSummary>> {
    const params = new HttpParams().set('page', 1).set('size', size);
    return this.http.get<PagedResult<NoteAuthorSummary>>(this.api.tenantUrl('/auth/users'), { params });
  }
}
