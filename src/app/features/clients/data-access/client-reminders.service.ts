import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { PagedResult } from './clients.model';
import {
  CancelReminderRequest,
  CreateReminderRequest,
  REMINDERS_PAGE_SIZE,
  ReminderResponse,
  ReminderStatus,
  SnoozeReminderRequest,
  UpdateReminderScheduleRequest,
  UpdateReminderSubjectRequest,
} from './client-reminders.model';

/**
 * Cliente HTTP fino sobre `RemindersController` (`/reminders`, servicio Reminder.Api vía
 * Gateway).
 *
 * No hay endpoint de listado por target: `mine` es el único listado general y filtra por el
 * `UserId` del JWT dentro del SQL (un recordatorio ajeno responde 404, nunca 403 — ni
 * PlatformAdmin lee los de otro). Ver el comentario de cabecera de `client-reminders.model.ts`.
 */
@Injectable({ providedIn: 'root' })
export class ClientRemindersService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/reminders');
  }

  /** GET /reminders/mine — recordatorios del usuario logueado. `status` es el único filtro. */
  listMine(status?: ReminderStatus, page = 1, size = REMINDERS_PAGE_SIZE): Observable<PagedResult<ReminderResponse>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (status) {
      params = params.set('status', status);
    }
    return this.http.get<PagedResult<ReminderResponse>>(`${this.base}/mine`, { params });
  }

  create(req: CreateReminderRequest): Observable<ReminderResponse> {
    return this.http.post<ReminderResponse>(this.base, req);
  }

  /** PUT /reminders/{id}/schedule — mueve el disparo; solo Scheduled o Snoozed. */
  updateSchedule(id: string, req: UpdateReminderScheduleRequest): Observable<ReminderResponse> {
    return this.http.put<ReminderResponse>(`${this.base}/${id}/schedule`, req);
  }

  /** PUT /reminders/{id}/subject — título (obligatorio, ≤200) y cuerpo (opcional, ≤2000), texto plano. */
  updateSubject(id: string, req: UpdateReminderSubjectRequest): Observable<ReminderResponse> {
    return this.http.put<ReminderResponse>(`${this.base}/${id}/subject`, req);
  }

  /** POST /reminders/{id}/snooze — solo sobre un recordatorio ya disparado (Status == Fired). */
  snooze(id: string, minutes: number): Observable<ReminderResponse> {
    const req: SnoozeReminderRequest = { minutes };
    return this.http.post<ReminderResponse>(`${this.base}/${id}/snooze`, req);
  }

  /** POST /reminders/{id}/dismiss — terminal; Fired o Snoozed. */
  dismiss(id: string): Observable<ReminderResponse> {
    return this.http.post<ReminderResponse>(`${this.base}/${id}/dismiss`, {});
  }

  /**
   * DELETE /reminders/{id} — cancelar NO borra: transiciona a `Cancelled` y devuelve la fila
   * (200, no 204). La razón es obligatoria en el aggregate, por eso viaja en el body.
   */
  cancel(id: string, reason: string): Observable<ReminderResponse> {
    const body: CancelReminderRequest = { reason };
    return this.http.delete<ReminderResponse>(`${this.base}/${id}`, { body });
  }
}
