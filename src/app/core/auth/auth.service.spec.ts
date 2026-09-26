import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { TenantBrandingService } from '../theme/tenant-branding.service';
import { ApiConfigService } from '../config/api-config.service';
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

  /**
   * Regresión (bleed de marca entre sesiones): el logout debe soltar la marca del tenant, o el
   * logo/favicon/colores del usuario saliente sobreviven en esta pestaña hasta recargar a mano.
   */
  it('logout resetea la marca del tenant', () => {
    environment.authMock = true;
    const branding = TestBed.inject(TenantBrandingService);
    const resetSpy = vi.spyOn(branding, 'reset');
    service.login(credentials).subscribe();

    service.logout().subscribe();

    expect(resetSpy).toHaveBeenCalled();
  });

  /**
   * Regresión: el SPA se sirve en `app.taxproffice.com`, que NO es un slug de oficina,
   * así que en producción `tenantBase()` lanza. Si el login no cayera al host de
   * sistema, nadie podría iniciar sesión desde la portada.
   */
  it('sin oficina resuelta, el login va al host de sistema en vez de fallar', () => {
    const originalProduction = environment.production;
    const originalApiUrl = environment.apiUrl;
    environment.production = true;
    environment.apiUrl = '';
    environment.authMock = false;

    try {
      service.login({ email: 'a@b.com', password: 'secret' }).subscribe({ error: () => {} });
      const req = httpMock.expectOne(`https://${environment.systemHost}/auth/login`);
      // `tenantId` vacío rompe la deserialización de `Guid?` en el backend: no debe viajar.
      expect(req.request.body.tenantId).toBeUndefined();
      req.flush({ code: 'Auth.Invalid', message: 'Invalid credentials.' }, { status: 401, statusText: 'Unauthorized' });
    } finally {
      environment.production = originalProduction;
      environment.apiUrl = originalApiUrl;
    }
  });

  // Regresión: en dev se mandaba environment.tenantId y el reset buscaba al usuario solo en esa oficina.
  it('el olvido de contraseña no manda la oficina en el body', () => {
    environment.authMock = false;

    service.forgotPassword('a@b.com').subscribe();

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/password/forgot`);
    expect(req.request.body).toEqual({ email: 'a@b.com', accountKind: 'Staff' });
    req.flush(null, { status: 202, statusText: 'Accepted' });
  });

  // "Manage subscription": el vale sale de la sesión del CRM; el Landing lo canjea al llegar.
  it('pide el vale para abrir el Account del Landing', () => {
    environment.authMock = false;

    service.requestAccountHandoff().subscribe();

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/account/handoff`);
    expect(req.request.method).toBe('POST');
    req.flush({ ticket: 'tk-1', expiresInSeconds: 60 });
  });

  it('valida el enlace de reset sin mandar contraseña', () => {
    environment.authMock = false;

    service.validateResetToken('raw-1').subscribe();

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/password/reset/validate`);
    expect(req.request.body).toEqual({ token: 'raw-1' });
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  describe('olvido de contraseña en producción', () => {
    const originalProduction = environment.production;
    let api: ApiConfigService;

    beforeEach(() => {
      environment.production = true;
      environment.authMock = false;
      api = TestBed.inject(ApiConfigService);
    });

    afterEach(() => (environment.production = originalProduction));

    it('en la dirección de una oficina va al host de esa oficina', () => {
      vi.spyOn(api, 'officeFromHost').mockReturnValue('coretaxpro');
      api.setSlug('coretaxpro');

      service.forgotPassword('a@b.com').subscribe();

      httpMock
        .expectOne(`https://coretaxpro.${environment.baseDomain}/auth/password/forgot`)
        .flush(null, { status: 202, statusText: 'Accepted' });
    });

    it('en la entrada general va al host de sistema aunque el navegador recuerde una oficina', () => {
      vi.spyOn(api, 'officeFromHost').mockReturnValue(null);
      api.setSlug('otra-oficina');

      service.forgotPassword('a@b.com').subscribe();

      httpMock
        .expectOne(`https://${environment.systemHost}/auth/password/forgot`)
        .flush(null, { status: 202, statusText: 'Accepted' });
    });
  });
});
