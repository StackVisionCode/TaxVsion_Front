import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { TokenService } from '@core/auth/token.service';
import { ApiConfigService } from '@core/config/api-config.service';
import { ProfileStore } from './profile.store';

describe('ProfileStore · teléfono', () => {
  let store: ProfileStore;
  let http: HttpTestingController;
  let url: string;
  const me = vi.fn();

  beforeEach(() => {
    me.mockReset().mockReturnValue(of({}));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { me, currentUser: signal(null) } },
        { provide: TokenService, useValue: { accessToken: signal(null) } },
      ],
    });
    store = TestBed.inject(ProfileStore);
    http = TestBed.inject(HttpTestingController);
    url = TestBed.inject(ApiConfigService).tenantUrl('/auth/me/phone');
  });

  afterEach(() => http.verify());

  it('guarda el número con un solo PUT /auth/me/phone y rehidrata al usuario', () => {
    let done = false;
    store.updatePhone('+1 202 555 0112').subscribe(() => (done = true));

    const req = http.expectOne(url);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ phoneNumber: '+1 202 555 0112' });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(me).toHaveBeenCalledTimes(1);
    expect(done).toBe(true);
  });

  it('quitar el teléfono manda phoneNumber null', () => {
    store.updatePhone(null).subscribe();

    const req = http.expectOne(url);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ phoneNumber: null });
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(me).toHaveBeenCalledTimes(1);
  });

  it('nunca llama a los endpoints viejos de OTP', () => {
    store.updatePhone('5550112').subscribe();
    http.expectNone(r => r.url.includes('/me/phone/change-request') || r.url.includes('/me/phone/confirm'));
    http.expectOne(url).flush(null, { status: 204, statusText: 'No Content' });
  });

  it('el 400 del backend llega como error y no rehidrata', () => {
    let error: unknown;
    store.updatePhone('5550112').subscribe({ error: e => (error = e) });

    http
      .expectOne(url)
      .flush({ code: 'User.Phone', message: 'Phone number is invalid.' }, { status: 400, statusText: 'Bad Request' });

    expect(error).toBeTruthy();
    expect(me).not.toHaveBeenCalled();
  });

  it('si /auth/me falla tras guardar, el guardado igual se reporta como exitoso', () => {
    me.mockReturnValue(throwError(() => new Error('down')));
    let done = false;
    store.updatePhone('5550112').subscribe(() => (done = true));
    http.expectOne(url).flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBe(true);
  });
});
