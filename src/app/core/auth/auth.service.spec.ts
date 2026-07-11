import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { LoginRequest, LoginResponse } from './auth.model';

describe('AuthService', () => {
  let service: AuthService;
  let tokenService: TokenService;
  let httpMock: HttpTestingController;

  const originalMock = environment.authMock;
  const loginUrl = `${environment.apiUrl}/auth/login`;
  const credentials: LoginRequest = { tenantId: 't', email: 'a@b.com', password: 'secret' };

  const withTokens: LoginResponse = {
    mfaRequired: false,
    mfaSetupRequired: false,
    tokens: { accessToken: 'a', refreshToken: 'r', expiresInSeconds: 900, deviceToken: null },
    loginTicket: null,
    mfaMethods: null,
    ticketExpiresInSeconds: null,
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [AuthService, TokenService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    tokenService = TestBed.inject(TokenService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    environment.authMock = originalMock;
    httpMock.verify();
    localStorage.clear();
  });

  it('modo mock: entra sin tocar el backend', () => {
    environment.authMock = true;
    let kind = '';
    service.login(credentials).subscribe(o => (kind = o.kind));
    expect(kind).toBe('authenticated');
    expect(tokenService.isAuthenticated()).toBe(true);
    expect(service.currentUser()).not.toBeNull();
    httpMock.expectNone(loginUrl);
  });

  it('desenlace (c): tokens presentes → autenticado', () => {
    environment.authMock = false;
    let kind = '';
    service.login(credentials).subscribe(o => (kind = o.kind));
    httpMock.expectOne(loginUrl).flush(withTokens);
    expect(kind).toBe('authenticated');
    expect(tokenService.isAuthenticated()).toBe(true);
    expect(service.mustEnrollMfa()).toBe(false);
  });

  it('desenlace (b): mfaRequired → reto pendiente, sin sesión', () => {
    environment.authMock = false;
    let kind = '';
    service.login(credentials).subscribe(o => (kind = o.kind));
    httpMock.expectOne(loginUrl).flush({
      mfaRequired: true,
      mfaSetupRequired: false,
      tokens: null,
      loginTicket: 'ticket-123',
      mfaMethods: ['Totp'],
      ticketExpiresInSeconds: 300,
    } satisfies LoginResponse);
    expect(kind).toBe('mfa-required');
    expect(service.pendingMfa()?.loginTicket).toBe('ticket-123');
    expect(tokenService.isAuthenticated()).toBe(false);
  });

  it('desenlace (a): mfaSetupRequired → enrolar, con sesión activa', () => {
    environment.authMock = false;
    let kind = '';
    service.login(credentials).subscribe(o => (kind = o.kind));
    httpMock.expectOne(loginUrl).flush({
      ...withTokens,
      mfaSetupRequired: true,
    } satisfies LoginResponse);
    expect(kind).toBe('mfa-setup-required');
    expect(service.mustEnrollMfa()).toBe(true);
    expect(tokenService.isAuthenticated()).toBe(true);
  });

  it('logout limpia la sesión (modo mock)', () => {
    environment.authMock = true;
    service.login(credentials).subscribe();
    expect(tokenService.isAuthenticated()).toBe(true);
    service.logout().subscribe();
    expect(tokenService.isAuthenticated()).toBe(false);
    expect(service.currentUser()).toBeNull();
  });
});
