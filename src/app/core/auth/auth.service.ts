import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, defer, finalize, map, of, shareReplay, tap, throwError } from 'rxjs';
import { environment } from '@env/environment';
import { TokenService } from './token.service';
import { ApiConfigService } from '../config/api-config.service';
import {
  AuthTokens,
  ForgotPasswordRequest,
  LoginRequest,
  LoginResponse,
  MeResponse,
  RefreshRequest,
  ResetPasswordRequest,
  TermsAcceptanceResponse,
  TermsAcceptanceStatusResponse,
  TermsVersionResponse,
} from './auth.model';
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
  private readonly api = inject(ApiConfigService);
  /**
   * Base de los endpoints de Auth: la oficina resuelta (`https://<slug>.baseDomain`).
   *
   * Si todavía no hay oficina, cae al HOST DE SISTEMA en vez de reventar. El SPA se
   * sirve en `app.taxproffice.com`, que a propósito no es un slug de tenant, así que
   * sin este fallback **nadie podría iniciar sesión desde la portada**. Y no hace
   * falta conocer la oficina para entrar: `/auth/login` resuelve igual en el host de
   * sistema (verificado contra producción) y el tenant viaja en el JWT que devuelve.
   */
  private get base(): string {
    try {
      return this.api.tenantBase();
    } catch {
      return this.api.systemBase();
    }
  }

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
    // `TenantId` es `Guid?` en el backend: mandar "" (el valor de environment.tenantId
    // en producción, donde el tenant se resuelve por Host) rompe la deserialización y
    // devuelve 400. Se omite el campo salvo que traiga un valor real.
    const { tenantId, ...rest } = req;
    const body = tenantId ? { ...rest, tenantId } : rest;
    // `defer` para que un fallo al componer la URL (tenantBase() lanza si no hay oficina
    // resuelta) viaje por el canal de error del Observable. Sin esto la excepción es
    // síncrona, escapa al `subscribe({ error })` del componente y el botón de login se
    // queda girando para siempre sin decir nada.
    return defer(() => this.http.post<LoginResponse>(`${this.base}/auth/login`, body)).pipe(
      map(res => this.handleLoginResponse(res)),
    );
  }

  verifyMfa(req: VerifyMfaRequest): Observable<void> {
    if (environment.authMock) {
      return defer(() => {
        this.applyMockSession();
        return of(void 0);
      });
    }
    return defer(() => this.http.post<AuthTokens>(`${this.base}/auth/mfa/verify`, req)).pipe(
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

  /** Siempre resuelve (202 anti-enumeración): el backend nunca revela si el email existe. */
  forgotPassword(email: string): Observable<void> {
    const req: ForgotPasswordRequest = { email, tenantId: environment.tenantId || null };
    if (environment.authMock) {
      return defer(() => of(void 0));
    }
    return defer(() => this.http.post<void>(`${this.base}/auth/password/forgot`, req));
  }

  /** `token` sale del query param `?token=` del link emailado (`/reset-password?token=...`), no de un código tipeado. */
  resetPassword(token: string, newPassword: string): Observable<void> {
    const req: ResetPasswordRequest = { token, newPassword };
    if (environment.authMock) {
      return defer(() => of(void 0));
    }
    return defer(() => this.http.post<void>(`${this.base}/auth/password/reset`, req));
  }

  /** Limpia todo el estado de sesión en el cliente (sin llamar al backend). */
  logoutLocal(): void {
    this.tokenService.clear();
    this._currentUser.set(null);
    this._pendingMfa.set(null);
    this._mustEnrollMfa.set(false);
    this.refreshInFlight = null;
    // El slug recordado es parte de la sesión: sin esto, el siguiente usuario de este
    // navegador seguiría apuntando a la oficina anterior y su login fallaría con
    // "credenciales inválidas" sin explicación. Si el host identifica una oficina,
    // clearSlug() la conserva.
    this.api.clearSlug();
  }

  /** El componente de enrolamiento llama a esto tras confirmar el TOTP. */
  completeMfaEnrollment(): void {
    this._mustEnrollMfa.set(false);
  }

  // ---------- Términos (ToS/AUP) ----------

  /** Cacheado por sesión: una vez aceptado, el authGuard no re-chequea en cada navegación. */
  private readonly _termsAccepted = signal(false);
  readonly termsAccepted = this._termsAccepted.asReadonly();

  termsStatus(): Observable<TermsAcceptanceStatusResponse> {
    return this.http.get<TermsAcceptanceStatusResponse>(`${this.base}/auth/tenant/terms/status`);
  }

  acceptTerms(): Observable<TermsAcceptanceResponse> {
    return this.http
      .post<TermsAcceptanceResponse>(`${this.base}/auth/tenant/terms/accept`, {})
      .pipe(tap(() => this._termsAccepted.set(true)));
  }

  markTermsAccepted(): void {
    this._termsAccepted.set(true);
  }

  /** Documento legal vigente (recurso de plataforma, anónimo, en el host de sistema). */
  currentTermsVersion(kind: 'TermsOfService' | 'PrivacyPolicy', locale = 'en-US'): Observable<TermsVersionResponse> {
    const params = new URLSearchParams({ kind, locale });
    return this.http.get<TermsVersionResponse>(`${this.api.systemBase()}/auth/onboarding/terms/current?${params}`);
  }

  /** URL pública del documento legal renderizado (HTML), para abrirlo en una pestaña. */
  termsContentUrl(termsVersionId: string): string {
    return `${this.api.systemBase()}/auth/onboarding/terms/${termsVersionId}/content`;
  }

  /**
   * Marca que el usuario debe enrolar MFA. Lo usa el canje del login central (from-ticket) cuando
   * la política exige segundo factor pero aún no hay método: así el authGuard lo desvía al setup,
   * igual que el desenlace `mfa-setup-required` del login directo.
   */
  requireMfaEnrollment(): void {
    this._mustEnrollMfa.set(true);
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
      email: 'demo@taxprooffice.local',
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
