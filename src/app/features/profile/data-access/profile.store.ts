import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { TokenService } from '@core/auth/token.service';
import { toApiError } from '@core/models/api-error.model';
import { ProfileService } from './profile.service';
import { UpdateMyProfileRequest, UserSession } from './profile.model';

/**
 * Store de la página de perfil (mismo patrón que ClientsStore): estado de lista
 * (sesiones activas) en signals + acciones que devuelven Observables para que el
 * componente maneje el feedback puntual (toasts/busy) por operación.
 *
 * Tras un guardado que altera al usuario cacheado (perfil, email, teléfono) se
 * re-consulta `AuthService.me()` para rehidratar `currentUser` — es best-effort:
 * si /auth/me falla, el guardado igual se reporta como exitoso.
 */
@Injectable({ providedIn: 'root' })
export class ProfileStore {
  private readonly service = inject(ProfileService);
  private readonly auth = inject(AuthService);
  private readonly tokens = inject(TokenService);

  private readonly _sessions = signal<UserSession[]>([]);
  private readonly _sessionsLoading = signal(false);
  private readonly _sessionsError = signal<string | null>(null);

  readonly sessions = this._sessions.asReadonly();
  readonly sessionsLoading = this._sessionsLoading.asReadonly();
  readonly sessionsError = this._sessionsError.asReadonly();

  /** Session id de la sesión actual (claim `sid` del access token) para marcar "This device". */
  readonly currentSessionId = computed(() => sessionIdFromJwt(this.tokens.accessToken()));

  loadSessions(): void {
    this._sessionsLoading.set(true);
    this._sessionsError.set(null);
    this.service.getMySessions().subscribe({
      next: sessions => {
        this._sessions.set(sessions);
        this._sessionsLoading.set(false);
      },
      error: err => {
        this._sessionsError.set(toApiError(err).message);
        this._sessionsLoading.set(false);
      },
    });
  }

  /** Revoca una sesión propia y la retira de la lista. */
  revokeSession(sessionId: string): Observable<void> {
    return this.service
      .revokeSession(sessionId)
      .pipe(tap(() => this._sessions.update(list => list.filter(s => s.id !== sessionId))));
  }

  /** "Sign out everywhere else": revoca todas menos la actual y refresca la lista. */
  revokeOtherSessions(): Observable<void> {
    return this.service.revokeOtherSessions().pipe(tap(() => this.loadSessions()));
  }

  /**
   * PUT /auth/users/me/profile. El backend solo acepta name/lastName/timeZoneId;
   * el timeZoneId actual se preserva tal cual (no hay campo de UI para editarlo).
   */
  saveProfile(input: { name: string; lastName: string }): Observable<void> {
    const req: UpdateMyProfileRequest = {
      name: input.name,
      lastName: input.lastName,
      timeZoneId: this.auth.currentUser()?.timeZoneId ?? null,
    };
    return this.service.updateMyProfile(req).pipe(switchMap(() => this.refreshUser()));
  }

  /** POST /auth/password/change. El backend revoca las demás sesiones, así que se refresca la lista. */
  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.service
      .changePassword({ currentPassword, newPassword })
      .pipe(tap(() => this.loadSessions()));
  }

  requestEmailChange(newEmail: string): Observable<void> {
    return this.service.requestEmailChange(newEmail);
  }

  confirmEmailChange(token: string): Observable<void> {
    return this.service.confirmEmailChange(token).pipe(switchMap(() => this.refreshUser()));
  }

  requestPhoneChange(phoneNumber: string): Observable<void> {
    return this.service.requestPhoneChange(phoneNumber);
  }

  confirmPhone(code: string): Observable<void> {
    return this.service.confirmPhone(code).pipe(switchMap(() => this.refreshUser()));
  }

  /** Rehidrata AuthService.currentUser tras un cambio; nunca convierte el éxito en error. */
  private refreshUser(): Observable<void> {
    return this.auth.me().pipe(
      map(() => void 0),
      catchError(() => of(void 0)),
    );
  }
}

/** Extrae el claim `sid` del payload del JWT (base64url), o null si no se puede. */
function sessionIdFromJwt(token: string | null): string | null {
  if (!token) {
    return null;
  }
  const payload = token.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as Record<string, unknown>;
    return typeof claims['sid'] === 'string' ? claims['sid'] : null;
  } catch {
    return null;
  }
}
