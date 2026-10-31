import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Observable,
  Subject,
  catchError,
  defer,
  filter,
  finalize,
  from,
  map,
  of,
  switchMap,
  take,
  takeUntil,
  tap,
  throwError,
  timer,
} from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { TokenService } from '@core/auth/token.service';
import { toApiError } from '@core/models/api-error.model';
import {
  PROFILE_PHOTO_MESSAGES,
  PROFILE_PHOTO_PREPARER,
  ProfilePhotoError,
} from '@core/profile-photo/profile-photo-image.util';
import {
  PHOTO_BLOCKED_MESSAGE,
  PHOTO_POLL_DELAY_MS,
  PHOTO_POLL_INTERVAL_MS,
  PHOTO_POLL_MAX_TRIES,
  pollPhotoOutcome,
} from '@core/profile-photo/profile-photo-upload';
import { ProfileService } from './profile.service';
import {
  PHOTO_FAILED_MESSAGE,
  PhotoStatus,
  PhotoUploadOutcome,
  UpdateMyProfileRequest,
  UserSession,
  classifyAvatarPoll,
} from './profile.model';

// Tiempos del sondeo: compartidos con la foto del cliente (Client 360).
export { PHOTO_POLL_DELAY_MS, PHOTO_POLL_INTERVAL_MS, PHOTO_POLL_MAX_TRIES };

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
  private readonly preparePhoto = inject(PROFILE_PHOTO_PREPARER);

  private readonly _sessions = signal<UserSession[]>([]);
  private readonly _sessionsLoading = signal(false);
  private readonly _sessionsError = signal<string | null>(null);

  readonly sessions = this._sessions.asReadonly();
  readonly sessionsLoading = this._sessionsLoading.asReadonly();
  readonly sessionsError = this._sessionsError.asReadonly();

  /** Session id de la sesión actual (claim `sid` del access token) para marcar "This device". */
  readonly currentSessionId = computed(() => sessionIdFromJwt(this.tokens.accessToken()));

  // Foto de perfil: fase actual + último error para mostrar junto al avatar.
  private readonly _photoStatus = signal<PhotoStatus>('idle');
  private readonly _photoError = signal<string | null>(null);
  /** Corta el sondeo anterior al subir otra foto o quitarla. */
  private readonly cancelPhoto$ = new Subject<void>();

  readonly photoStatus = this._photoStatus.asReadonly();
  readonly photoError = this._photoError.asReadonly();
  readonly photoBusy = computed(() => this._photoStatus() !== 'idle');

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

  /** PUT /auth/me/phone y rehidrata currentUser; `null` quita el teléfono. */
  updatePhone(phoneNumber: string | null): Observable<void> {
    return this.service.updateMyPhone(phoneNumber).pipe(switchMap(() => this.refreshUser()));
  }

  /**
   * Prepara la imagen (recorte cuadrado + JPEG), la sube con PUT /auth/me/avatar y sondea hasta que el
   * antivirus la confirme o la descarte. Emite una vez el desenlace y rehidrata la sesión (navbar).
   * Los errores de preparación y los 400/413 del backend quedan en `photoError` y se re-lanzan.
   */
  uploadPhoto(file: File): Observable<PhotoUploadOutcome> {
    return defer(() => {
      this.cancelPhoto$.next();
      this._photoError.set(null);
      this._photoStatus.set('preparing');
      return from(this.preparePhoto(file)).pipe(
        tap(() => this._photoStatus.set('uploading')),
        switchMap(prepared => this.service.uploadMyAvatar(prepared)),
        tap(() => this._photoStatus.set('processing')),
        switchMap(response => this.pollAvatar(response.fileId)),
        switchMap(outcome => this.refreshUser().pipe(map(() => outcome))),
        tap(outcome => {
          if (outcome === 'failed') {
            this._photoError.set(PHOTO_FAILED_MESSAGE);
          } else if (outcome === 'blocked') {
            this._photoError.set(PHOTO_BLOCKED_MESSAGE);
          }
        }),
        catchError(err => {
          this._photoError.set(photoUploadErrorMessage(err));
          return throwError(() => err);
        }),
        takeUntil(this.cancelPhoto$),
        finalize(() => this._photoStatus.set('idle')),
      );
    });
  }

  /** DELETE /auth/me/avatar y rehidrata la sesión: el navbar vuelve a las iniciales. */
  removePhoto(): Observable<void> {
    return defer(() => {
      this.cancelPhoto$.next();
      this._photoError.set(null);
      this._photoStatus.set('removing');
      return this.service.deleteMyAvatar().pipe(
        switchMap(() => this.refreshUser()),
        catchError(err => {
          this._photoError.set(toApiError(err).message);
          return throwError(() => err);
        }),
        finalize(() => this._photoStatus.set('idle')),
      );
    });
  }

  /**
   * Si se entra al perfil con una foto aún en escaneo (p. ej. tras recargar), sondea hasta que deje de
   * estar pendiente y rehidrata la sesión. Sin toast: no sabemos qué foto fue.
   */
  resumePendingPhoto(): void {
    const user = this.auth.currentUser();
    // En revisión de contenido espera a un revisor: sondear no adelanta nada (el aviso queda en la página).
    if (!user?.avatarPending || user.avatarModerationStatus === 'under_review' || this.photoBusy()) {
      return;
    }
    this._photoStatus.set('processing');
    timer(PHOTO_POLL_DELAY_MS, PHOTO_POLL_INTERVAL_MS)
      .pipe(
        take(PHOTO_POLL_MAX_TRIES),
        switchMap(() => this.service.getMyAvatarState().pipe(catchError(() => of(null)))),
        filter(state => !!state && !state.avatarPending),
        take(1),
        switchMap(() => this.refreshUser()),
        takeUntil(this.cancelPhoto$),
        finalize(() => this._photoStatus.set('idle')),
      )
      .subscribe();
  }

  /** Sondea GET /auth/me hasta que la foto `fileId` quede confirmada o descartada; si no, `timeout`. */
  private pollAvatar(fileId: string): Observable<PhotoUploadOutcome> {
    return pollPhotoOutcome(
      () => this.service.getMyAvatarState(),
      state => classifyAvatarPoll(state, fileId),
    );
  }

  /** Rehidrata AuthService.currentUser tras un cambio; nunca convierte el éxito en error. */
  private refreshUser(): Observable<void> {
    return this.auth.me().pipe(
      map(() => void 0),
      catchError(() => of(void 0)),
    );
  }
}

/**
 * Texto para el usuario de un fallo al subir la foto: el de la preparación local, el del backend en
 * los 400 `Avatar.*`, y uno propio para el 413 (el proxy puede responderlo sin cuerpo JSON).
 */
function photoUploadErrorMessage(err: unknown): string {
  if (err instanceof ProfilePhotoError) {
    return err.message;
  }
  if (err instanceof HttpErrorResponse) {
    if (err.status === 413) {
      return PROFILE_PHOTO_MESSAGES.tooLarge;
    }
    if (err.status === 403) {
      return "Profile photos aren't available for this account.";
    }
    if (err.status === 400) {
      const message = (err.error as { message?: string } | null)?.message;
      return message || PHOTO_FAILED_MESSAGE;
    }
  }
  return toApiError(err).message;
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
