import { HttpInterceptorFn, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicFormsService } from './public-forms.service';

describe('PublicFormsService', () => {
  let service: PublicFormsService;
  let http: HttpTestingController;
  const intercepted = vi.fn();
  const authInterceptor: HttpInterceptorFn = (request, next) => {
    intercepted(request.url);
    return next(request.clone({ setHeaders: { Authorization: 'Bearer staff-token' } }));
  };

  beforeEach(() => {
    intercepted.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: ApiConfigService,
          useValue: { tenantUrl: (path: string) => `https://office.example${path}` },
        },
      ],
    });
    service = TestBed.inject(PublicFormsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('no envia Authorization al abrir un enlace publico', () => {
    service.getAccess('directed', 'access token').subscribe();

    const request = http.expectOne(
      'https://office.example/tasks/public/forms/access/access%20token',
    );
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.headers.has('X-Form-Session')).toBe(false);
    expect(intercepted).not.toHaveBeenCalled();
    request.flush({});
  });

  it('usa solo X-Form-Session para leer la request protegida', () => {
    service.getRequest('session-token').subscribe();

    const request = http.expectOne('https://office.example/tasks/public/forms/session/request');
    expect(request.request.headers.get('X-Form-Session')).toBe('session-token');
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(intercepted).not.toHaveBeenCalled();
    request.flush({});
  });

  it('no filtra tokens al storage presignado', () => {
    const file = new File(['safe'], 'safe.txt', { type: 'text/plain' });
    service
      .uploadToStorage(
        {
          fileId: 'file-1',
          attachmentId: 'attachment-1',
          rowVersion: 'rv-1',
          presignedPost: {
            url: 'https://storage.example/upload',
            formData: { key: 'forms/file-1' },
            expiresAtUtc: '2030-01-01T00:00:00Z',
          },
        },
        file,
      )
      .subscribe();

    const request = http.expectOne('https://storage.example/upload');
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.headers.has('X-Form-Session')).toBe(false);
    expect(intercepted).not.toHaveBeenCalled();
    request.flush('');
  });
});
