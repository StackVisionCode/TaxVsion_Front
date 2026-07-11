import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, defer, finalize, map, of, shareReplay, tap, throwError } from 'rxjs';
import { environment } from '@env/environment';
import { TokenService } from './token.service';
import { AuthTokens, LoginRequest, LoginResponse, MeResponse, RefreshRequest } from './auth.model';
import { MfaMethodType, PendingMfa, VerifyMfaRequest } from './mfa.model';

/** Desenlace del login, ya interpretado por el servicio (el componente solo enruta). */
export type LoginOutcome =
  | { kind: 'authenticated' }
  | { kind: 'mfa-required'; methods: MfaMethodType[] }
  | { kind: 'mfa-setup-required' };

/**
 * Servicio de autenticación transversal. Orquesta el login (incluido MFA),
 * refresh, /me y logout, y mantiene el estado de sesión en signals.
 *
 * Modo mock (`environment.authMock`): salta el backend y crea una sesión
 * sintética exitosa — permite trabajar con el backend caído.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly tokenService = inject(TokenService);
  private readonly base = environment.apiUrl;

  private readonly _currentUser = signal<MeResponse | null>(null);
  private readonly _pendingMfa = signal<PendingMfa | null>(null);
  private readonly _mustEnrollMfa = signal(false);

  readonly currentUser = this._currentUser.asReadonly();
  readonly pendingMfa = this._pendingMfa.asReadonly();
  readonly mustEnrollMfa = this._mustEnrollMfa.asReadonly();
  readonly isLoggedIn = computed(() => this._currentUser() !== null || this.tokenService.hasSession());

  /** Refresh en vuelo compartido (single-flight) para 401 concurrentes. */
  private refreshInFlight: Observable<AuthTokens> | null = null;

  login(req: LoginRequest): Observable<LoginOutcome> {
    if (environment.authMock) {
      return defer(() => {
        this.applyMockSession();
        return of<LoginOutcome>({ kind: 'authenticated' });
      });
    }
    return this.http
      .post<LoginResponse>(`${this.base}/auth/login`, req)
      .pipe(map(res => this.handleLoginResponse(res)));
  }

  verifyMfa(req: VerifyMfaRequest): Observable<void> {
    if (environment.authMock) {
      return defer(() => {
        this.applyMockSession();
        return of(void 0);
      });
    }
    return this.http.post<AuthTokens>(`${this.base}/auth/mfa/verify`, req).pipe(
      tap(tokens => {
        this.tokenService.setSession(tokens);
        this._pendingMfa.set(null);
      }),
      map(() => void 0),
    );
  }

  refresh(): Observable<AuthTokens> {
    if (environment.authMock) {
      const tokens = this.buildMockTokens();
      this.tokenService.setSession(tokens);
      return of(tokens);
    }
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    const refreshToken = this.tokenService.getRefreshToken();
    if (!refreshToken) {
      return throwError(() => new Error('No hay refresh token disponible.'));
    }
    this.refreshInFlight = this.http
      .post<AuthTokens>(`${this.base}/auth/refresh`, { refreshToken } satisfies RefreshRequest)
      .pipe(
        tap(tokens => this.tokenService.setSession(tokens)),
        finalize(() => {
          this.refreshInFlight = null;
        }),
        shareReplay(1),
      );
    return this.refreshInFlight;
  }

  me(): Observable<MeResponse> {
    if (environment.authMock) {
      const user = this.buildMockUser();
      this._currentUser.set(user);
      return of(user);
    }
    return this.http
      .get<MeResponse>(`${this.base}/auth/me`)
      .pipe(tap(user => this._currentUser.set(user)));
  }

  logout(): Observable<void> {
    if (environment.authMock) {
      return defer(() => {
        this.logoutLocal();
        return of(void 0);
      });
    }
    return this.http.post<void>(`${this.base}/auth/logout`, {}).pipe(
      catchError(() => of(void 0)),
      tap(() => this.logoutLocal()),
    );
  }

  /** Limpia todo el estado de sesión en el cliente (sin llamar al backend). */
  logoutLocal(): void {
    this.tokenService.clear();
    this._currentUser.set(null);
    this._pendingMfa.set(null);
    this._mustEnrollMfa.set(false);
    this.refreshInFlight = null;
  }

  /** El componente de enrolamiento llama a esto tras confirmar el TOTP. */
  completeMfaEnrollment(): void {
    this._mustEnrollMfa.set(false);
  }

  private handleLoginResponse(res: LoginResponse): LoginOutcome {
    if (res.mfaRequired && res.loginTicket) {
      const methods = (res.mfaMethods ?? []) as MfaMethodType[];
      this._pendingMfa.set({
        loginTicket: res.loginTicket,
        methods,
        expiresAt: Date.now() + (res.ticketExpiresInSeconds ?? 300) * 1000,
      });
      return { kind: 'mfa-required', methods };
    }
    if (res.tokens) {
      this.tokenService.setSession(res.tokens);
      this._pendingMfa.set(null);
      if (res.mfaSetupRequired) {
        this._mustEnrollMfa.set(true);
        return { kind: 'mfa-setup-required' };
      }
      this._mustEnrollMfa.set(false);
      return { kind: 'authenticated' };
    }
    throw new Error('Respuesta de login inesperada del servidor.');
  }

  private applyMockSession(): void {
    this.tokenService.setSession(this.buildMockTokens());
    this._currentUser.set(this.buildMockUser());
    this._pendingMfa.set(null);
    this._mustEnrollMfa.set(false);
  }

  private buildMockTokens(): AuthTokens {
    return {
      accessToken: 'mock.access.token',
      refreshToken: 'mock.refresh.token',
      expiresInSeconds: 3600,
      deviceToken: null,
    };
  }

  private buildMockUser(): MeResponse {
    return {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Usuario',
      lastName: 'Demo',
      email: 'demo@taxvision.local',
      actorType: 'TenantAdmin',
      customerId: null,
      tenant: { id: environment.tenantId, name: 'Tenant Demo', subDomain: 'demo' },
      roles: ['Admin'],
      permissions: [],
      timeZoneId: 'America/Santo_Domingo',
      mfaEnabled: false,
      emailVerified: true,
      phoneVerified: false,
      phoneNumber: null,
      plan: null,
    };
  }
}
