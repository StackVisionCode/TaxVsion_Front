import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { TokenService } from '@core/auth/token.service';
import { SubscriptionStatusStore } from '@core/billing/subscription-status.store';
import { ThrottleNoticeService } from '@core/errors/throttle-notice.service';
import { errorInterceptor } from './error.interceptor';

describe('errorInterceptor — throttling', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  const notice = { notify: vi.fn() };
  const auth = { refresh: vi.fn(), logoutLocal: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers();
    notice.notify.mockReset();
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
