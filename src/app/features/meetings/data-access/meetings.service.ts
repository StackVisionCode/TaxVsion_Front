import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  CreateMeetingInvitationsResponse,
  CreateMeetingRequest,
  CreateMeetingResponse,
  EndMeetingResponse,
  ListMeetingInvitationsResponse,
  MeetingCustomerEntry,
  MeetingEmployeeEntry,
  MeetingInviteeInput,
  MeetingsPageResponse,
  MeetingsScope,
  StartMeetingResponse,
} from './meeting.model';

/**
 * Cliente HTTP de meetings sobre el servicio Communication (`/communication`
 * vía Gateway). El JWT lo pone el interceptor global — acá no se agregan
 * headers. Nota de contrato: NO existe GET /meetings/{id} (detalle) ni ningún
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
  list(params: { scope: MeetingsScope; page?: number; size?: number }): Observable<MeetingsPageResponse> {
    let query = new HttpParams().set('scope', params.scope);
    if (params.page) {
      query = query.set('page', params.page);
    }
    if (params.size) {
      query = query.set('size', params.size);
    }
    return this.http.get<MeetingsPageResponse>(`${this.base}/meetings`, { params: query });
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

  searchCustomers(term: string, limit = 8): Observable<MeetingCustomerEntry[]> {
    const params = new HttpParams().set('q', term).set('limit', limit);
    return this.http.get<MeetingCustomerEntry[]>(`${this.base}/directory/customers`, { params });
  }
}
