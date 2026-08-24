import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  ChangePasswordRequest,
  ConfirmEmailChangeRequest,
  ConfirmPhoneRequest,
  RequestEmailChangeRequest,
  RequestPhoneVerificationRequest,
  UpdateMyProfileRequest,
  UserSession,
  toUtcIso,
} from './profile.model';

/**
 * Cliente HTTP fino sobre los endpoints "mi cuenta" del servicio Auth
 * (UsersController /auth/users, CredentialsController /auth, SessionsController
 * /auth/sessions). El interceptor agrega el Bearer; el backend identifica al
 * usuario por el JWT, nunca por parámetros del cliente.
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/auth');
  }

  /** PUT /auth/users/me/profile — solo name/lastName/timeZoneId; email y teléfono tienen flujos aparte. */
  updateMyProfile(req: UpdateMyProfileRequest): Observable<void> {
    return this.http.put<void>(`${this.base}/users/me/profile`, req);
  }

  /** POST /auth/password/change — 204. El backend revoca las demás sesiones al cambiarla. */
  changePassword(req: ChangePasswordRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/password/change`, req);
  }

  /** GET /auth/sessions/me — sesiones activas del usuario autenticado. */
  getMySessions(): Observable<UserSession[]> {
    return this.http.get<UserSession[]>(`${this.base}/sessions/me`).pipe(
      map(sessions =>
        sessions.map(s => ({
          ...s,
          createdAtUtc: toUtcIso(s.createdAtUtc),
          lastSeenAtUtc: toUtcIso(s.lastSeenAtUtc),
        })),
      ),
    );
  }

  /** DELETE /auth/sessions/{sessionId} — revoca una sesión propia. 204. */
  revokeSession(sessionId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/sessions/${sessionId}`);
  }

  /** DELETE /auth/sessions?includeCurrent=false — "cerrar sesión en los demás dispositivos". 204. */
  revokeOtherSessions(): Observable<void> {
    return this.http.delete<void>(`${this.base}/sessions`, {
      params: new HttpParams().set('includeCurrent', false),
    });
  }

  /** POST /auth/me/email/change-request — manda el token de confirmación al correo NUEVO. 202. */
  requestEmailChange(newEmail: string): Observable<void> {
    const body: RequestEmailChangeRequest = { newEmail };
    return this.http.post<void>(`${this.base}/me/email/change-request`, body);
  }

  /** POST /auth/me/email/confirm — confirma con el token recibido por correo. 204. */
  confirmEmailChange(token: string): Observable<void> {
    const body: ConfirmEmailChangeRequest = { token };
    return this.http.post<void>(`${this.base}/me/email/confirm`, body);
  }

  /** POST /auth/me/phone/change-request — manda un OTP por SMS al número nuevo. 202. */
  requestPhoneChange(phoneNumber: string): Observable<void> {
    const body: RequestPhoneVerificationRequest = { phoneNumber };
    return this.http.post<void>(`${this.base}/me/phone/change-request`, body);
  }

  /** POST /auth/me/phone/confirm — confirma el número con el OTP. 204. */
  confirmPhone(code: string): Observable<void> {
    const body: ConfirmPhoneRequest = { code };
    return this.http.post<void>(`${this.base}/me/phone/confirm`, body);
  }
}
