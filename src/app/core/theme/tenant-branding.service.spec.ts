import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TenantBrandingService } from './tenant-branding.service';
import { ThemeService } from './theme.service';

describe('TenantBrandingService', () => {
  let service: TenantBrandingService;
  let theme: ThemeService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TenantBrandingService);
    theme = TestBed.inject(ThemeService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  /**
   * Regresión del bleed entre sesiones: al cerrar sesión hay que soltar el logo/favicon y los colores
   * del tenant saliente (cacheados en señales y en localStorage), o el siguiente usuario de esta
   * pestaña los hereda hasta recargar a mano.
   */
  it('reset() limpia logo/favicon y vuelve el tema a los defaults', () => {
    const resetSpy = vi.spyOn(theme, 'resetToDefaults');

    service.reset();

    expect(service.logoUrl()).toBeNull();
    expect(service.faviconUrl()).toBeNull();
    expect(resetSpy).toHaveBeenCalled();
  });

  /** Sin tenantId no hay a quién pedirle la marca: no debe salir ninguna petición. */
  it('applyForTenant sin tenantId no dispara ninguna petición', () => {
    service.applyForTenant('', 'Crm');

    httpMock.expectNone(() => true);
  });

  it('carga el logo de plataforma sin reemplazar la marca ni el tema de la oficina', () => {
    const applySpy = vi.spyOn(theme, 'applyBranding');

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
    expect(applySpy).not.toHaveBeenCalled();

    service.loadSystemBrandLogo('Crm');
    httpMock.expectNone((candidate) =>
      candidate.url.includes('/tenants/branding/system?surface=Crm'),
    );
  });
});
