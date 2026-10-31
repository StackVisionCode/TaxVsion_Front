import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { readOnlyRequestContext } from '@core/http/read-only-request';
import {
  ContinueMeetingResponse,
  CreateMeetingInvitationsResponse,
  CreateMeetingRequest,
  CreateMeetingResponse,
  EndMeetingResponse,
  ListMeetingInvitationsResponse,
  MeetingCustomerEntry,
  MeetingEmployeeEntry,
  MeetingChatHistoryResponse,
  MeetingEventsPageResponse,
  MeetingInviteeInput,
  MeetingLimits,
  MeetingsPageResponse,
  MeetingsScope,
  MeetingStatsResponse,
  MeetingSummaryResponse,
  StartMeetingResponse,
} from './meeting.model';

/**
 * Cliente HTTP de meetings sobre el servicio Communication (`/communication`
 * vía Gateway). El JWT lo pone el interceptor global — acá no se agregan
 * headers. El detalle es la ficha (`/meetings/{id}/summary`, solo quien participó); no hay
 * endpoint de edición de título/descripción — solo reschedule de la fecha.
 * Unirse a la sala (WebRTC) es Socket.IO-only y queda fuera de este cliente.
 */
@Injectable({ providedIn: 'root' })
export class MeetingsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/communication');
  }

  /** GET /communication/meetings — upcoming = Scheduled+Live, past = Ended+Cancelled. */
  list(params: {
    scope: MeetingsScope;
    page?: number;
    size?: number;
    /** Opcional: solo meetings donde el cliente (vía su usuario de portal) es participante/invitado. */
    customerId?: string | null;
  }): Observable<MeetingsPageResponse> {
    let query = new HttpParams().set('scope', params.scope);
    if (params.customerId) {
      query = query.set('customerId', params.customerId);
    }
    if (params.page) {
      query = query.set('page', params.page);
    }
    if (params.size) {
      query = query.set('size', params.size);
    }
    return this.http.get<MeetingsPageResponse>(`${this.base}/meetings`, { params: query });
  }

  /** GET /communication/meetings/stats — contadores reales para las tarjetas del dashboard. */
  stats(): Observable<MeetingStatsResponse> {
    return this.http.get<MeetingStatsResponse>(`${this.base}/meetings/stats`);
  }

  /** GET /communication/meetings/limits — duración por defecto/máxima y cupo efectivos de la oficina (F3). */
  limits(): Observable<MeetingLimits> {
    return this.http.get<MeetingLimits>(`${this.base}/meetings/limits`);
  }

  /** POST /communication/meetings — requiere permiso `communication.meeting.create`. */
  create(req: CreateMeetingRequest): Observable<CreateMeetingResponse> {
    return this.http.post<CreateMeetingResponse>(`${this.base}/meetings`, req);
  }

  /** POST /communication/meetings/{id}/start — host-only; Scheduled → Live. */
  start(id: string): Observable<StartMeetingResponse> {
    return this.http.post<StartMeetingResponse>(`${this.base}/meetings/${id}/start`, {});
  }

  /** POST /communication/meetings/{id}/end — termina el meeting para todos. */
  end(id: string): Observable<EndMeetingResponse> {
    return this.http.post<EndMeetingResponse>(`${this.base}/meetings/${id}/end`, {});
  }

  /**
   * F3 — POST /communication/meetings/{id}/continue: "Start a new meeting" tras un fin por tiempo (D-34,
   * sin prórroga). Host/cohost de una terminada + `communication.meeting.create`; crea "X (cont.)" con los
   * mismos invitados. Después se inicia con `start` y se entra con el join normal.
   */
  continueMeeting(id: string): Observable<ContinueMeetingResponse> {
    return this.http.post<ContinueMeetingResponse>(`${this.base}/meetings/${id}/continue`, {});
  }

  /** POST /communication/meetings/{id}/cancel — host-only, solo desde Scheduled. 204. */
  cancel(id: string, reason?: string): Observable<void> {
    return this.http.post<void>(`${this.base}/meetings/${id}/cancel`, reason ? { reason } : {});
  }

  /**
   * POST /communication/meetings/{id}/reschedule — host/cohost, solo desde
   * Scheduled. `newScheduledForUtc: null` des-agenda (meeting instantáneo). 204.
   */
  reschedule(id: string, newScheduledForUtc: string | null): Observable<void> {
    return this.http.post<void>(`${this.base}/meetings/${id}/reschedule`, { newScheduledForUtc });
  }

  // ---------- Ficha del meeting ----------

  /** Ficha: resumen, asistencia por persona, invitados que no entraron y totales. */
  summary(id: string): Observable<MeetingSummaryResponse> {
    return this.http.get<MeetingSummaryResponse>(`${this.base}/meetings/${id}/summary`);
  }

  /** Actividad de la ficha (el servidor omite voz, calidad y media), paginada por `seq`. */
  events(id: string, afterSeq: number | null, take = 100): Observable<MeetingEventsPageResponse> {
    let params = new HttpParams().set('take', take).set('activity', 'true');
    if (afterSeq !== null) {
      params = params.set('after', afterSeq);
    }
    return this.http.get<MeetingEventsPageResponse>(`${this.base}/meetings/${id}/events`, { params });
  }

  /** F8a (D-01) — chat de la sala (más nuevo primero), paginado con `before`. */
  chatHistory(id: string, before: string | null, take = 50): Observable<MeetingChatHistoryResponse> {
    let params = new HttpParams().set('take', take);
    if (before) {
      params = params.set('before', before);
    }
    return this.http.get<MeetingChatHistoryResponse>(`${this.base}/meetings/${id}/chat`, { params });
  }

  // ---------- Invitaciones (host/cohost) ----------

  /** POST /communication/meetings/{id}/invitations — única respuesta que trae el joinUrl completo. */
  createInvitations(id: string, invitees: MeetingInviteeInput[]): Observable<CreateMeetingInvitationsResponse> {
    return this.http.post<CreateMeetingInvitationsResponse>(`${this.base}/meetings/${id}/invitations`, { invitees });
  }

  /** GET /communication/meetings/{id}/invitations — metadata, sin token ni joinUrl. */
  listInvitations(id: string): Observable<ListMeetingInvitationsResponse> {
    return this.http.get<ListMeetingInvitationsResponse>(`${this.base}/meetings/${id}/invitations`);
  }

  /** DELETE /communication/meetings/{id}/invitations/{invitationId} — 204. */
  revokeInvitation(id: string, invitationId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/meetings/${id}/invitations/${invitationId}`);
  }

  // ---------- Directorio para el picker de invitados (q min 1, limit ≤ 25) ----------

  searchEmployees(term: string, limit = 8): Observable<MeetingEmployeeEntry[]> {
    const params = new HttpParams().set('q', term).set('limit', limit);
    return this.http.get<MeetingEmployeeEntry[]>(`${this.base}/directory/employees`, { params });
  }

  /** POST: el término (a menudo un email) va en el cuerpo, no en la URL. */
  searchCustomers(term: string, limit = 8): Observable<MeetingCustomerEntry[]> {
    return this.http.post<MeetingCustomerEntry[]>(
      `${this.base}/directory/customers/search`,
      { q: term, limit },
      { context: readOnlyRequestContext() },
    );
  }
}
