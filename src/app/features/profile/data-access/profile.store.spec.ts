import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { TokenService } from '@core/auth/token.service';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  PROFILE_PHOTO_MESSAGES,
  PROFILE_PHOTO_PREPARER,
  ProfilePhotoError,
} from '@core/profile-photo/profile-photo-image.util';
import { PHOTO_FAILED_MESSAGE } from './profile.model';
import { PHOTO_POLL_DELAY_MS, PHOTO_POLL_INTERVAL_MS, PHOTO_POLL_MAX_TRIES, ProfileStore } from './profile.store';

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

describe('ProfileStore · foto de perfil', () => {
  let store: ProfileStore;
  let http: HttpTestingController;
  let avatarUrl: string;
  let meUrl: string;
  const me = vi.fn();
  const prepare = vi.fn();
  const prepared = new File(['jpeg'], 'me.jpg', { type: 'image/jpeg' });
  const picked = new File(['raw'], 'me.heic', { type: 'image/heic' });
  const accepted = { fileId: 'f-new', status: 'processing' };

  beforeEach(() => {
    vi.useFakeTimers();
    me.mockReset().mockReturnValue(of({}));
    prepare.mockReset().mockResolvedValue(prepared);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { me, currentUser: signal(null) } },
        { provide: TokenService, useValue: { accessToken: signal(null) } },
        { provide: PROFILE_PHOTO_PREPARER, useValue: prepare },
      ],
    });
    store = TestBed.inject(ProfileStore);
    http = TestBed.inject(HttpTestingController);
    const api = TestBed.inject(ApiConfigService);
    avatarUrl = api.tenantUrl('/auth/me/avatar');
    meUrl = api.tenantUrl('/auth/me');
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  /** Lanza la subida y devuelve el PUT pendiente (la preparación es una promesa). */
  async function startUpload(outcomes: unknown[] = [], errors: unknown[] = []) {
    store.uploadPhoto(picked).subscribe({ next: o => outcomes.push(o), error: e => errors.push(e) });
    await vi.advanceTimersByTimeAsync(0);
    return http.expectOne(avatarUrl);
  }

  /** Avanza hasta el siguiente tick del sondeo y responde GET /auth/me. */
  async function pollTick(state: { avatarFileId: string | null; avatarPending: boolean }, ms = PHOTO_POLL_INTERVAL_MS) {
    await vi.advanceTimersByTimeAsync(ms);
    http.expectOne(r => r.method === 'GET' && r.url === meUrl).flush(state);
  }

  it('prepara la imagen, la sube como multipart `file` y queda procesando', async () => {
    const put = await startUpload();

    expect(prepare).toHaveBeenCalledWith(picked);
    expect(put.request.method).toBe('PUT');
    const body = put.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('file') as File).name).toBe('me.jpg');
    put.flush(accepted, { status: 202, statusText: 'Accepted' });

    expect(store.photoStatus()).toBe('processing');
    expect(store.photoBusy()).toBe(true);
    http.expectNone(meUrl);
    store.removePhoto().subscribe();
    http.expectOne(r => r.method === 'DELETE').flush(null, { status: 204, statusText: 'No Content' });
  });

  it('sondea hasta que /auth/me trae la foto nueva, rehidrata la sesión y emite updated', async () => {
    const outcomes: unknown[] = [];
    (await startUpload(outcomes)).flush(accepted, { status: 202, statusText: 'Accepted' });

    await pollTick({ avatarFileId: 'f-old', avatarPending: true }, PHOTO_POLL_DELAY_MS);
    expect(outcomes).toEqual([]);
    expect(me).not.toHaveBeenCalled();

    await pollTick({ avatarFileId: 'f-new', avatarPending: false });

    expect(outcomes).toEqual(['updated']);
    expect(me).toHaveBeenCalledTimes(1);
    expect(store.photoStatus()).toBe('idle');
    expect(store.photoError()).toBeNull();
  });

  it('si deja de estar pendiente sin ser la foto nueva, emite failed con el mensaje para el usuario', async () => {
    const outcomes: unknown[] = [];
    (await startUpload(outcomes)).flush(accepted, { status: 202, statusText: 'Accepted' });

    await pollTick({ avatarFileId: 'f-old', avatarPending: false }, PHOTO_POLL_DELAY_MS);

    expect(outcomes).toEqual(['failed']);
    expect(store.photoError()).toBe(PHOTO_FAILED_MESSAGE);
    expect(store.photoStatus()).toBe('idle');
  });

  it('tras los reintentos sin respuesta emite timeout (un /auth/me caído cuenta como pendiente)', async () => {
    const outcomes: unknown[] = [];
    (await startUpload(outcomes)).flush(accepted, { status: 202, statusText: 'Accepted' });

    await vi.advanceTimersByTimeAsync(PHOTO_POLL_DELAY_MS);
    http.expectOne(meUrl).flush(null, { status: 500, statusText: 'Server Error' });
    for (let i = 1; i < PHOTO_POLL_MAX_TRIES; i++) {
      await pollTick({ avatarFileId: null, avatarPending: true });
    }
    await vi.advanceTimersByTimeAsync(PHOTO_POLL_INTERVAL_MS * 3);
    http.expectNone(meUrl);

    expect(outcomes).toEqual(['timeout']);
    expect(me).toHaveBeenCalledTimes(1);
    expect(store.photoStatus()).toBe('idle');
  });

  it('el 400 Avatar.* muestra el mensaje del backend', async () => {
    const errors: unknown[] = [];
    (await startUpload([], errors)).flush(
      { code: 'Avatar.TooSmall', message: 'The image must be at least 64x64 pixels.' },
      { status: 400, statusText: 'Bad Request' },
    );

    expect(errors).toHaveLength(1);
    expect(store.photoError()).toBe('The image must be at least 64x64 pixels.');
    expect(store.photoStatus()).toBe('idle');
    expect(me).not.toHaveBeenCalled();
  });

  it('el 413 sin cuerpo JSON muestra el límite de 5 MB', async () => {
    const errors: unknown[] = [];
    (await startUpload([], errors)).flush('<html>413</html>', { status: 413, statusText: 'Payload Too Large' });

    expect(errors).toHaveLength(1);
    expect(store.photoError()).toBe(PROFILE_PHOTO_MESSAGES.tooLarge);
  });

  it('un fallo de preparación no llama al backend y deja su mensaje', async () => {
    prepare.mockRejectedValue(new ProfilePhotoError(PROFILE_PHOTO_MESSAGES.notImage));
    const errors: unknown[] = [];
    store.uploadPhoto(picked).subscribe({ error: e => errors.push(e) });
    await vi.advanceTimersByTimeAsync(0);

    http.expectNone(avatarUrl);
    expect(errors).toHaveLength(1);
    expect(store.photoError()).toBe(PROFILE_PHOTO_MESSAGES.notImage);
    expect(store.photoStatus()).toBe('idle');
  });

  it('quitar la foto hace DELETE /auth/me/avatar y rehidrata la sesión', () => {
    let done = false;
    store.removePhoto().subscribe(() => (done = true));
    expect(store.photoStatus()).toBe('removing');

    const req = http.expectOne(avatarUrl);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(done).toBe(true);
    expect(me).toHaveBeenCalledTimes(1);
    expect(store.photoStatus()).toBe('idle');
  });

  it('quitar la foto corta el sondeo de una subida en curso', async () => {
    const outcomes: unknown[] = [];
    (await startUpload(outcomes)).flush(accepted, { status: 202, statusText: 'Accepted' });

    store.removePhoto().subscribe();
    http.expectOne(r => r.method === 'DELETE').flush(null, { status: 204, statusText: 'No Content' });
    await vi.advanceTimersByTimeAsync(PHOTO_POLL_DELAY_MS + PHOTO_POLL_INTERVAL_MS);

    http.expectNone(meUrl);
    expect(outcomes).toEqual([]);
  });
});
