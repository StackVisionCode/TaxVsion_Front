import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { TokenService } from '@core/auth/token.service';
import { SubscriptionStatusStore } from '@core/billing/subscription-status.store';
import { ThrottleNoticeService } from '@core/errors/throttle-notice.service';
import { EntitlementsNoticeService } from '@core/access/entitlements-notice.service';
import { errorInterceptor } from './error.interceptor';

describe('errorInterceptor — throttling', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  const notice = { notify: vi.fn() };
  const entitlements = { notify: vi.fn() };
  const auth = { refresh: vi.fn(), logoutLocal: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers();
    notice.notify.mockReset();
    entitlements.notify.mockReset();
    auth.refresh.mockReset();
    auth.logoutLocal.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: ThrottleNoticeService, useValue: notice },
        { provide: AuthService, useValue: auth },
        { provide: TokenService, useValue: { getRefreshToken: () => 'refresh-token' } },
        { provide: SubscriptionStatusStore, useValue: { markBlockedFromError: vi.fn() } },
        { provide: EntitlementsNoticeService, useValue: entitlements },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
  });

  it('a throttled write is not retried: one global notice and the error reaches the screen', () => {
    let failed: HttpErrorResponse | undefined;
    http.post('/customers', {}).subscribe({ error: err => (failed = err) });

    httpMock
      .expectOne('/customers')
      .flush({ code: 'RateLimit.Exceeded', retryAfterSeconds: 30 }, { status: 429, statusText: 'Too Many Requests' });

    expect(failed?.status).toBe(429);
    expect(notice.notify).toHaveBeenCalledWith({ kind: 'rate-limited', retryAfterSeconds: 30 });
  });

  it('a GET shed with a short wait is retried once in silence', () => {
    let body: unknown;
    http.get('/customers').subscribe(res => (body = res));

    httpMock
      .expectOne('/customers')
      .flush({ code: 'LoadShedding.Active', retryAfterSeconds: 2 }, { status: 503, statusText: 'Service Unavailable' });
    vi.advanceTimersByTime(2000);
    httpMock.expectOne('/customers').flush({ items: [] });

    expect(body).toEqual({ items: [] });
    expect(notice.notify).not.toHaveBeenCalled();
  });

  it('if the silent retry is throttled again, it notifies instead of retrying forever', () => {
    let failed: HttpErrorResponse | undefined;
    http.get('/customers').subscribe({ error: err => (failed = err) });

    const shed = { code: 'LoadShedding.Active', retryAfterSeconds: 2 };
    httpMock.expectOne('/customers').flush(shed, { status: 503, statusText: 'Service Unavailable' });
    vi.advanceTimersByTime(2000);
    httpMock.expectOne('/customers').flush(shed, { status: 503, statusText: 'Service Unavailable' });

    expect(failed?.status).toBe(503);
    expect(notice.notify).toHaveBeenCalledTimes(1);
  });

  it('a GET with a long wait is not retried', () => {
    http.get('/tasks/board').subscribe({ error: () => undefined });

    httpMock
      .expectOne('/tasks/board')
      .flush({ code: 'RateLimit.Exceeded', retryAfterSeconds: 40 }, { status: 429, statusText: 'Too Many Requests' });
    vi.advanceTimersByTime(60_000);

    httpMock.expectNone('/tasks/board');
    expect(notice.notify).toHaveBeenCalledWith({ kind: 'rate-limited', retryAfterSeconds: 40 });
  });

  it('a throttled refresh keeps the session (no logout) and explains the wait', () => {
    const throttledRefresh = new HttpErrorResponse({
      status: 429,
      error: { code: 'RateLimit.Exceeded', retryAfterSeconds: 12 },
    });
    auth.refresh.mockReturnValue(throwError(() => throttledRefresh));
    let failed: unknown;
    http.get('/auth/me').subscribe({ error: err => (failed = err) });

    httpMock.expectOne('/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(auth.logoutLocal).not.toHaveBeenCalled();
    expect(notice.notify).toHaveBeenCalledWith({ kind: 'rate-limited', retryAfterSeconds: 12 });
    expect(failed).toBe(throttledRefresh);
  });
});

/**
 * Un 403 del REINTENTO no es el fin de la sesión.
 *
 * Encontrado en vivo en el Portal (QA de C9, 2026-09-27) y presente aquí con la misma forma: el
 * `catchError` estaba DESPUÉS del `switchMap`, así que atrapaba el error del reintento, y
 * `isRefreshRejected` da true para 400/401/403. Al revocar una permission: 401 `TokenStale` →
 * refresh CORRECTO → reintento 403 legítimo → `logoutLocal()` + recarga dura de la pestaña.
 *
 * Cuanto mejor funciona el RBAC en vivo, más se dispara.
 */
describe('errorInterceptor — 403 tras renovar el token', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  const auth = { refresh: vi.fn(), logoutLocal: vi.fn() };

  beforeEach(() => {
    auth.refresh.mockReset();
    auth.logoutLocal.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: ThrottleNoticeService, useValue: { notify: vi.fn() } },
        { provide: AuthService, useValue: auth },
        { provide: TokenService, useValue: { getRefreshToken: () => 'refresh-token' } },
        { provide: SubscriptionStatusStore, useValue: { markBlockedFromError: vi.fn() } },
        { provide: EntitlementsNoticeService, useValue: { notify: vi.fn() } },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('un 403 del reintento NO cierra la sesión: el error llega a la pantalla', async () => {
    auth.refresh.mockReturnValue(of({ accessToken: 'at-nuevo' }));
    let status: number | undefined;
    http.get('/api/clients').subscribe({ error: (e: HttpErrorResponse) => (status = e.status) });

    httpMock.expectOne('/api/clients').flush({ code: 'Auth.TokenStale' }, { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();
    httpMock.expectOne('/api/clients').flush({ code: 'Authz.PermissionDenied' }, { status: 403, statusText: 'Forbidden' });
    await Promise.resolve();

    expect(status).toBe(403);
    expect(auth.logoutLocal).not.toHaveBeenCalled();
  });

  it('pero un refresh RECHAZADO sí cierra la sesión', async () => {
    // La otra mitad: si el refresh token ya no sirve, la sesión terminó de verdad.
    auth.refresh.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
    http.get('/api/clients').subscribe({ error: () => undefined });

    httpMock.expectOne('/api/clients').flush({ code: 'Auth.TokenStale' }, { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();

    expect(auth.logoutLocal).toHaveBeenCalled();
  });
});

describe('errorInterceptor — enlaces por correo', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  const auth = { refresh: vi.fn(), logoutLocal: vi.fn() };

  beforeEach(() => {
    auth.refresh.mockReset();
    auth.logoutLocal.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: ThrottleNoticeService, useValue: { notify: vi.fn() } },
        { provide: AuthService, useValue: auth },
        { provide: TokenService, useValue: { getRefreshToken: () => 'refresh-token' } },
        { provide: SubscriptionStatusStore, useValue: { markBlockedFromError: vi.fn() } },
        { provide: EntitlementsNoticeService, useValue: { notify: () => undefined } },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // Con sesión abierta en el navegador, un 401 de estos endpoints es el token del correo, no la sesión.
  it.each(['/auth/password/reset/validate', '/auth/password/reset', '/auth/me/email/confirm', '/auth/invitations/accept'])(
    'un token de correo que ya no sirve en %s no renueva ni cierra la sesión',
    path => {
      let failed: HttpErrorResponse | undefined;
      http.post(path, {}).subscribe({ error: err => (failed = err) });

      httpMock.expectOne(path).flush({ code: 'Auth.InvalidResetToken' }, { status: 401, statusText: 'Unauthorized' });

      expect(failed?.status).toBe(401);
      expect(auth.refresh).not.toHaveBeenCalled();
      expect(auth.logoutLocal).not.toHaveBeenCalled();
    },
  );
});

/**
 * B7 — el 403 del gate de módulo. No es "no tenés permiso": la oficina no contrató el módulo, y la
 * salida es comercial. Mandar a alguien a contratar un plan cuando lo que le falta es un permiso es
 * peor que no decirle nada — lo manda a gastar dinero para algo que no lo va a arreglar.
 */
describe('errorInterceptor — módulo fuera del plan', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  const entitlements = { notify: vi.fn() };

  beforeEach(() => {
    entitlements.notify.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: ThrottleNoticeService, useValue: { notify: vi.fn() } },
        { provide: AuthService, useValue: { refresh: vi.fn(), logoutLocal: vi.fn() } },
        { provide: TokenService, useValue: { getRefreshToken: () => 'refresh-token' } },
        { provide: SubscriptionStatusStore, useValue: { markBlockedFromError: vi.fn() } },
        { provide: EntitlementsNoticeService, useValue: entitlements },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('avisa con el nombre del módulo y el error sigue su camino', () => {
    // La pantalla igual recibe el error para decidir qué pintar; lo que cambia es que ahora alguien
    // sabe POR QUÉ y puede recargar el bootstrap.
    let failed: HttpErrorResponse | undefined;
    http.get('/chat/conversations').subscribe({ error: err => (failed = err) });

    httpMock.expectOne('/chat/conversations').flush(
      { code: 'Authz.ModuleUnavailable', reason: 'module', module: 'comms', message: 'Not in plan' },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(entitlements.notify).toHaveBeenCalledWith('comms');
    expect(failed?.status).toBe(403);
  });

  it('un 403 corriente de permiso NO pasa por el aviso comercial', () => {
    http.get('/customers').subscribe({ error: () => undefined });

    httpMock.expectOne('/customers').flush(
      { code: 'Authz.PermissionDenied', reason: 'permission', message: 'Nope' },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(entitlements.notify).not.toHaveBeenCalled();
  });

  it('un 403 sin `reason` tampoco: el backend viejo cae del lado conservador', () => {
    http.get('/customers').subscribe({ error: () => undefined });

    httpMock.expectOne('/customers').flush({ code: 'Forbidden', message: 'Nope' }, { status: 403, statusText: 'Forbidden' });

    expect(entitlements.notify).not.toHaveBeenCalled();
  });
});
