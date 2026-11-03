import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { TenantBrandingService } from './tenant-branding.service';

describe('TenantBrandingService', () => {
  let service: TenantBrandingService;
  let httpMock: HttpTestingController;
  let api: ApiConfigService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TenantBrandingService);
    httpMock = TestBed.inject(HttpTestingController);
    api = TestBed.inject(ApiConfigService);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  /**
   * Regresión del bleed entre sesiones: al cerrar sesión hay que soltar el logo/favicon del tenant
   * saliente (cacheados en señales), o el siguiente usuario de esta pestaña los hereda hasta
   * recargar a mano.
   */
  it('reset() limpia logo/favicon', () => {
    service.reset();

    expect(service.logoUrl()).toBeNull();
    expect(service.faviconUrl()).toBeNull();
  });

  /** Sin tenantId no hay a quién pedirle la marca: no debe salir ninguna petición. */
  it('applyForTenant sin tenantId no dispara ninguna petición', () => {
    service.applyForTenant('', 'Crm');

    httpMock.expectNone(() => true);
  });

  /** Quien abre un enlace público no tiene oficina resuelta: la base sale de la clave, no de tenantBase(). */
  it('applyForPublicBrandingKey pide la marca por el subdominio de la clave sin depender de tenantBase', () => {
    const tenantBaseSpy = vi.spyOn(api, 'tenantBase');
    vi.spyOn(api, 'officeBase').mockImplementation((slug) => `https://${slug}.taxoffix.io`);

    service.applyForPublicBrandingKey('Manfer.taxoffix.io', 'Portal');

    const request = httpMock.expectOne(
      'https://manfer.taxoffix.io/tenants/branding/public/manfer?surface=Portal',
    );
    request.flush({ primary: '#1', accent: '#2', logoUrl: '/tenants/branding/assets/logo', faviconUrl: null });

    expect(tenantBaseSpy).not.toHaveBeenCalled();
    expect(service.logoUrl()).toBe('https://manfer.taxoffix.io/tenants/branding/assets/logo?v=1');
  });

  it('carga el logo de plataforma sin reemplazar la marca ni el tema de la oficina', () => {
    service.loadSystemBrandLogo('Crm');

    const request = httpMock.expectOne((candidate) =>
      candidate.url.includes('/tenants/branding/system?surface=Crm'),
    );
    request.flush({
      primary: '#123456',
      accent: '#abcdef',
      logoUrl: '/tenants/branding/assets/platform-logo',
      faviconUrl: '/tenants/branding/assets/platform-favicon',
    });

    expect(service.systemLogoUrl()).toContain('/tenants/branding/assets/platform-logo?v=1');
    expect(service.logoUrl()).toBeNull();
    expect(service.faviconUrl()).toBeNull();

    service.loadSystemBrandLogo('Crm');
    httpMock.expectNone((candidate) =>
      candidate.url.includes('/tenants/branding/system?surface=Crm'),
    );
  });

  it('carga la marca de plataforma por el origen del tenant en una firma publica', () => {
    vi.spyOn(api, 'officeFromHost').mockReturnValue('manfer');
    vi.spyOn(api, 'tenantBase').mockReturnValue('https://manfer.taxproffice.com');
    vi.spyOn(api, 'tenantUrl').mockImplementation(
      (path) => `https://manfer.taxproffice.com${path}`,
    );
    const systemUrlSpy = vi.spyOn(api, 'systemUrl');

    service.loadSystemBrandLogo('Crm');

    const request = httpMock.expectOne(
      'https://manfer.taxproffice.com/tenants/branding/system?surface=Crm',
    );
    request.flush({
      primary: '#123456',
      accent: '#abcdef',
      logoUrl: '/tenants/branding/assets/platform-logo',
      faviconUrl: '/tenants/branding/assets/platform-favicon',
    });

    expect(service.systemLogoUrl()).toBe(
      'https://manfer.taxproffice.com/tenants/branding/assets/platform-logo?v=1',
    );
    expect(systemUrlSpy).not.toHaveBeenCalled();
  });
});
