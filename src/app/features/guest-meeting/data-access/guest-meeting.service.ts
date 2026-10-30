import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { anonymousRequestContext } from '@core/http/anonymous-request';
import { GuestJoinByTokenResponse, GuestMeetingContext } from './guest-meeting.model';

/**
 * F6 — Cliente HTTP de la página pública de invitado (`/meet/:token`). Todas las llamadas van
 * marcadas como anónimas: sin Bearer (aunque haya una sesión de staff en este navegador) y sin
 * refresh/redirección al login ante un 401.
 */
@Injectable({ providedIn: 'root' })
export class GuestMeetingService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/communication/meetings');
  }

  /** GET /communication/meetings/guest/{token}/context — 404 uniforme si el token no vale. */
  context(token: string): Observable<GuestMeetingContext> {
    return this.http.get<GuestMeetingContext>(`${this.base}/guest/${encodeURIComponent(token)}/context`, {
      context: anonymousRequestContext(),
    });
  }

  /** POST /communication/meetings/join-by-token — 404 uniforme; 403 `Meeting.GuestsNotAllowed`. */
  joinByToken(token: string, displayName: string): Observable<GuestJoinByTokenResponse> {
    return this.http.post<GuestJoinByTokenResponse>(
      `${this.base}/join-by-token`,
      { token, displayName },
      { context: anonymousRequestContext() },
    );
  }
}
