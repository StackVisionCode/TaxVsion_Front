import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { ProfileService } from './profile.service';

describe('ProfileService · foto de perfil', () => {
  let service: ProfileService;
  let http: HttpTestingController;
  let api: ApiConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ProfileService);
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(ApiConfigService);
  });

  afterEach(() => http.verify());

  it('sube la foto con PUT /auth/me/avatar en multipart, campo `file`', () => {
    const file = new File(['jpeg'], 'me.jpg', { type: 'image/jpeg' });
    let response: unknown;
    service.uploadMyAvatar(file).subscribe(r => (response = r));

    const req = http.expectOne(api.tenantUrl('/auth/me/avatar'));
    expect(req.request.method).toBe('PUT');
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('file') as File).name).toBe('me.jpg');
    req.flush({ fileId: 'f-1', status: 'processing' }, { status: 202, statusText: 'Accepted' });

    expect(response).toEqual({ fileId: 'f-1', status: 'processing' });
  });

  it('quita la foto con DELETE /auth/me/avatar', () => {
    service.deleteMyAvatar().subscribe();

    const req = http.expectOne(api.tenantUrl('/auth/me/avatar'));
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('el sondeo lee solo la foto, su pendiente y su moderación de GET /auth/me (con defaults si faltan)', () => {
    const states: unknown[] = [];
    service.getMyAvatarState().subscribe(s => states.push(s));
    service.getMyAvatarState().subscribe(s => states.push(s));

    const [first, second] = http.match(api.tenantUrl('/auth/me'));
    first.flush({ id: 'u', name: 'Ana', avatarFileId: 'f-1', avatarPending: true, avatarModerationStatus: 'under_review', avatarModerationFileId: 'f-2' });
    second.flush({ id: 'u', name: 'Ana' });

    expect(states).toEqual([
      { avatarFileId: 'f-1', avatarPending: true, avatarModerationStatus: 'under_review', avatarModerationFileId: 'f-2' },
      { avatarFileId: null, avatarPending: false, avatarModerationStatus: null, avatarModerationFileId: null },
    ]);
  });
});
