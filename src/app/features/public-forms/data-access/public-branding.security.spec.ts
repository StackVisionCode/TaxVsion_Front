import { HttpInterceptorFn, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('public form branding security', () => {
  let branding: TenantBrandingService;
  let http: HttpTestingController;
  const intercepted = vi.fn();
  const authInterceptor: HttpInterceptorFn = (request, next) => {
    intercepted(request.url);
    return next(request.clone({ setHeaders: { Authorization: 'Bearer stale-token' } }));
  };

  beforeEach(() => {
    intercepted.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: ApiConfigService,
          useValue: {
            tenantBase: () => 'https://office.example',
            tenantUrl: (path: string) => `https://office.example${path}`,
          },
        },
      ],
    });
    branding = TestBed.inject(TenantBrandingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('carga la marca publica sin bearer ni interceptor de staff', () => {
    branding.applyForPublicBrandingKey('office.example', 'Crm');

    const request = http.expectOne(
      'https://office.example/tenants/branding/public/office?surface=Crm',
    );
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(intercepted).not.toHaveBeenCalled();
    request.flush({ primary: '#123456', accent: '#abcdef', logoUrl: null, faviconUrl: null });
  });
});
