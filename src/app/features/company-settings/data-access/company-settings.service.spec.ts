import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { OfficeProfile, UpdateOfficeProfileRequest } from './company-settings.model';
import { CompanySettingsService } from './company-settings.service';

/** El perfil de la oficina se lee y guarda en Tenant; Billing ya no recibe escrituras. */
describe('CompanySettingsService · perfil de la oficina', () => {
  const BASE = 'https://api.test';
  const PROFILE: OfficeProfile = {
    legalName: 'Castillo Tax Services LLC',
    displayName: 'Castillo Tax',
    entityType: 'Llc',
    ein: '12-3456789',
    phone: null,
    email: null,
    website: null,
    physicalAddress: { line1: null, line2: null, city: null, state: null, postalCode: null, country: 'US' },
    mailingSameAsPhysical: true,
    mailingAddress: null,
    defaultLanguage: 'en',
    businessHours: [{ day: 'Monday', opens: '09:00', closes: '18:00' }],
    bookingUrl: null,
    reviewUrl: null,
    version: 3,
    updatedAtUtc: '2026-11-03T10:00:00',
  };

  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantBase: () => BASE } },
      ],
    });
    return { service: TestBed.inject(CompanySettingsService), http: TestBed.inject(HttpTestingController) };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('lee el perfil de /tenants/current/profile', () => {
    const { service, http } = setup();
    let received: OfficeProfile | undefined;

    service.getProfile().subscribe(p => (received = p));

    const req = http.expectOne(`${BASE}/tenants/current/profile`);
    expect(req.request.method).toBe('GET');
    req.flush(PROFILE);
    expect(received).toEqual(PROFILE);
    http.verify();
  });

  it('guarda con PUT el cuerpo tal cual, incluidos los campos que la página no conoce', () => {
    const { service, http } = setup();
    const body: Record<string, unknown> = { ...PROFILE, futureField: 'kept' };
    delete body['version'];
    delete body['updatedAtUtc'];

    service.saveProfile(body as unknown as UpdateOfficeProfileRequest).subscribe();

    const req = http.expectOne(`${BASE}/tenants/current/profile`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(body);
    expect(req.request.body.futureField).toBe('kept');
    req.flush({ ...PROFILE, version: 4 });
    http.expectNone(`${BASE}/billing/issuer-profile`);
    http.verify();
  });

  it('ajustes de factura: GET y PUT de estado completo en Billing', () => {
    const { service, http } = setup();
    const settings = { paymentTerms: 'Net15', paymentInstructions: null, invoiceFooter: 'Thanks' };

    service.getInvoiceSettings().subscribe();
    http.expectOne(r => r.method === 'GET' && r.url === `${BASE}/billing/invoice-settings`).flush(settings);
    service.saveInvoiceSettings(settings).subscribe();
    const put = http.expectOne(r => r.method === 'PUT' && r.url === `${BASE}/billing/invoice-settings`);
    expect(put.request.body).toEqual(settings);
    put.flush(settings);
    http.verify();
  });

  it('cumplimiento: GET, PUT y reveal del EFIN por POST', () => {
    const { service, http } = setup();
    let revealed: string | undefined;

    service.getCompliance().subscribe();
    http.expectOne(r => r.method === 'GET' && r.url === `${BASE}/tenants/current/compliance`).flush({});
    service.saveCompliance({ efin: '', securityCoordinatorUserId: null, wispAdoptedOn: null, wispLastReviewedOn: null, incidentContactEmail: null, incidentContactPhone: null, retentionYears: null }).subscribe();
    const put = http.expectOne(r => r.method === 'PUT' && r.url === `${BASE}/tenants/current/compliance`);
    expect(put.request.body.efin).toBe('');
    put.flush({});
    service.revealEfin().subscribe(r => (revealed = r.efin));
    http.expectOne(r => r.method === 'POST' && r.url === `${BASE}/tenants/current/compliance/efin/reveal`).flush({ efin: '123456' });
    expect(revealed).toBe('123456');
    http.verify();
  });
});
