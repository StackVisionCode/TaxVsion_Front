import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { AvatarUrlService, buildAvatarUrl } from './avatar-url';
import { AvatarUrlPipe } from './avatar-url.pipe';

describe('buildAvatarUrl', () => {
  it('arma /storage/avatars/{fileId} sobre la base del tenant', () => {
    expect(buildAvatarUrl('https://acme.taxoffix.io', 'abc-123')).toBe(
      'https://acme.taxoffix.io/storage/avatars/abc-123',
    );
    expect(buildAvatarUrl('http://localhost:5000/', 'abc')).toBe('http://localhost:5000/storage/avatars/abc');
  });

  it('sin fileId no hay URL (el avatar cae a las iniciales)', () => {
    expect(buildAvatarUrl('https://acme.taxoffix.io', null)).toBeNull();
    expect(buildAvatarUrl('https://acme.taxoffix.io', '  ')).toBeNull();
  });

  it('codifica el id', () => {
    expect(buildAvatarUrl('https://x.io', 'a/b')).toBe('https://x.io/storage/avatars/a%2Fb');
  });
});

describe('AvatarUrlService', () => {
  it('usa la misma base que el resto de la API del tenant', () => {
    const service = TestBed.inject(AvatarUrlService);
    const api = TestBed.inject(ApiConfigService);

    expect(service.url('f-1')).toBe(api.tenantUrl('/storage/avatars/f-1'));
    expect(service.url(null)).toBeNull();
  });

  it('si todavía no hay tenant resuelto devuelve null en vez de lanzar', () => {
    TestBed.overrideProvider(ApiConfigService, {
      useValue: {
        tenantBase: () => {
          throw new Error('no slug');
        },
      },
    });

    expect(TestBed.inject(AvatarUrlService).url('f-1')).toBeNull();
  });
});

describe('AvatarUrlPipe', () => {
  it('convierte el fileId en la URL del avatar o null', () => {
    const pipe = TestBed.runInInjectionContext(() => new AvatarUrlPipe());
    const api = TestBed.inject(ApiConfigService);

    expect(pipe.transform('f-1')).toBe(api.tenantUrl('/storage/avatars/f-1'));
    expect(pipe.transform(null)).toBeNull();
    expect(pipe.transform(undefined)).toBeNull();
  });
});
