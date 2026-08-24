import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { PagedResult } from '../../clients/data-access/clients.model';
import { CreateNoteRequest, NoteResponse } from '../../clients/data-access/client-notes.model';

/**
 * Cliente HTTP del widget "Notes" del dashboard (Notes.Api vía Gateway).
 *
 * Existe aparte de `ClientNotesService` porque ese servicio solo expone el
 * listado por cliente (`GET /notes?targetType=Customer&targetId=...`), y el
 * dashboard necesita las notas del USUARIO, que es otro endpoint:
 * `GET /notes/mine` (permiso `notes.read`).
 *
 * Y no se usa `ClientNotesStore` porque ese store guarda un único `clientId`
 * privado: cargarlo desde el dashboard le borraría el estado a la pestaña de
 * notas del perfil de cliente.
 */
@Injectable({ providedIn: 'root' })
export class DashboardNotesService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/notes');
  }

  /** GET /notes/mine — las notas escritas por el usuario logueado, de cualquier target. */
  listMine(page = 1, size = 10): Observable<PagedResult<NoteResponse>> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<PagedResult<NoteResponse>>(`${this.base}/mine`, { params });
  }

  /**
   * POST /notes con `targetType: 'None'` — nota "suelta", sin cliente ni tarea
   * asociada. Es el único target que el dominio admite con `targetId: null`
   * (ver NoteReference.Create), y es exactamente lo que es una nota rápida del
   * dashboard. Requiere el permiso `notes.manage`.
   *
   * El backend sanitiza el HTML (Ganss.Xss); aun así el texto se escapa acá
   * para que lo que el usuario teclee se guarde como texto, no como markup.
   */
  createQuickNote(text: string): Observable<NoteResponse> {
    const request: CreateNoteRequest = {
      html: `<p>${escapeHtml(text)}</p>`,
      targetType: 'None',
      targetId: null,
      visibility: 'Private',
      colorKind: 'Default',
    };
    return this.http.post<NoteResponse>(this.base, request);
  }

  /** DELETE /notes/{id} — borrado lógico; el backend exige ser el autor. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
