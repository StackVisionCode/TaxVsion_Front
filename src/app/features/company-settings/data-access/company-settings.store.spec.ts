import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { InvoiceSettings, OfficeCompliance, OfficeIdentity, OfficeProfile } from './company-settings.model';
import { CompanySettingsService } from './company-settings.service';
import { CompanySettingsStore, EFIN_REVEAL_MS, SaveOutcome } from './company-settings.store';
import { toCompanyProfile } from './office-profile.mapper';

/** Store: carga por permiso, PUT de estado completo, guardado en paralelo y errores por campo. */
describe('CompanySettingsStore', () => {
  /** Perfil con todo lleno, para comprobar que el PUT no borra nada. */
  const RAW: OfficeProfile = {
    legalName: 'Castillo Tax Services LLC',
    displayName: 'Castillo Tax',
    entityType: 'Llc',
    ein: '12-3456789',
    phone: '(202) 555-0112',
    email: 'office@castillotax.com',
    website: null,
    physicalAddress: { line1: '1600 Main St', line2: null, city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
    mailingSameAsPhysical: false,
    mailingAddress: { line1: 'PO Box 12', line2: null, city: 'Austin', state: 'TX', postalCode: '78702', country: 'US' },
    defaultLanguage: 'es',
    businessHours: [{ day: 'Monday', opens: '09:00', closes: '18:00' }],
    bookingUrl: 'https://cal.example.com/castillo',
    reviewUrl: 'https://g.page/castillo',
    version: 7,
    updatedAtUtc: '2026-11-03T10:00:00',
  };
  const OFFICE: OfficeIdentity = { id: 't-1', name: 'Castillo Tax', subdomain: 'castillo', defaultTimeZoneId: 'Etc/UTC' };
  const INVOICE: InvoiceSettings = { paymentTerms: 'DueOnReceipt', paymentInstructions: null, invoiceFooter: null };
  const COMPLIANCE: OfficeCompliance = {
    hasEfin: true,
    efinMasked: '••••23',
    securityCoordinatorUserId: null,
    wispAdoptedOn: null,
    wispLastReviewedOn: null,
    incidentContactEmail: null,
    incidentContactPhone: null,
    retentionYears: null,
    updatedAtUtc: null,
  };
  const COMPLIANCE_REQUEST = {
    securityCoordinatorUserId: null,
    wispAdoptedOn: null,
    wispLastReviewedOn: null,
    incidentContactEmail: null,
    incidentContactPhone: null,
    retentionYears: 5,
  };

  function setup(raw: OfficeProfile = RAW) {
    const service = {
      getProfile: vi.fn(() => of(raw)),
      saveProfile: vi.fn((request: object) => of({ ...raw, ...request, version: raw.version + 1 } as OfficeProfile)),
      getOffice: vi.fn(() => of(OFFICE)),
      saveOffice: vi.fn(() => of(void 0)),
      getInvoiceSettings: vi.fn(() => of(INVOICE)),
      saveInvoiceSettings: vi.fn((request: InvoiceSettings) => of(request)),
      getCompliance: vi.fn(() => of(COMPLIANCE)),
      saveCompliance: vi.fn(() => of({ ...COMPLIANCE, retentionYears: 5 })),
      revealEfin: vi.fn(() => of({ efin: '123423' })),
    };
    const auth = { currentUser: signal({ tenant: { id: 't-1', name: 'Castillo Tax' } }), applyTenantName: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        CompanySettingsStore,
        { provide: CompanySettingsService, useValue: service },
        { provide: AuthService, useValue: auth },
      ],
    });
    return { store: TestBed.inject(CompanySettingsStore), service, auth };
  }

  function badRequest(code: string, message: string) {
    return throwError(() => new HttpErrorResponse({ status: 400, error: { code, message } }));
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  describe('carga', () => {
    it('solo pide lo que el usuario puede leer (sin 403 en consola)', () => {
      const { store, service } = setup();

      store.loadAll({ office: false, invoice: false, compliance: false });

      expect(service.getProfile).toHaveBeenCalled();
      expect(service.getOffice).not.toHaveBeenCalled();
      expect(service.getInvoiceSettings).not.toHaveBeenCalled();
      expect(service.getCompliance).not.toHaveBeenCalled();
    });

    it('con todos los permisos carga las cuatro partes', () => {
      const { store } = setup();

      store.loadAll({ office: true, invoice: true, compliance: true });

      expect(store.officeProfile()).toEqual(RAW);
      expect(store.office()).toEqual(OFFICE);
      expect(store.invoiceSettings()).toEqual(INVOICE);
      expect(store.compliance()).toEqual(COMPLIANCE);
    });

    it('un fallo de carga queda en el aviso de su sección', () => {
      const { store, service } = setup();
      service.getInvoiceSettings.mockReturnValue(badRequest('Billing.Down', 'Billing is unavailable.'));

      store.loadInvoiceSettings();

      expect(store.invoiceError()).toBe('Billing is unavailable.');
      expect(store.invoiceLoading()).toBe(false);
    });
  });

  describe('perfil: estado completo', () => {
    it('manda lo editado (DBA, entidad, postal, idioma, horario, enlaces) y conserva campos que el front no conoce', () => {
      const withUnknown = { ...RAW, complianceBadge: 'gold' } as OfficeProfile;
      const { store, service } = setup(withUnknown);
      store.loadProfile();
      const form = toCompanyProfile(withUnknown);

      store
        .saveProfile({
          ...form,
          displayName: 'Castillo & Co',
          entityType: 'SCorp',
          defaultLanguage: 'en',
          mailingSameAsPhysical: true,
          reviewUrl: 'yelp.com/biz/castillo',
          hours: form.hours.map(d => (d.day === 'Saturday' ? { ...d, open: true, opens: '10:00', closes: '13:00' } : d)),
        })
        .subscribe();

      const body = service.saveProfile.mock.calls[0][0] as Record<string, unknown>;
      expect(body).toMatchObject({
        legalName: 'Castillo Tax Services LLC',
        displayName: 'Castillo & Co',
        entityType: 'SCorp',
        defaultLanguage: 'en',
        mailingSameAsPhysical: true,
        mailingAddress: null,
        reviewUrl: 'https://yelp.com/biz/castillo',
        businessHours: [
          { day: 'Monday', opens: '09:00', closes: '18:00' },
          { day: 'Saturday', opens: '10:00', closes: '13:00' },
        ],
        complianceBadge: 'gold',
      });
      expect(body).not.toHaveProperty('version');
      expect(body).not.toHaveProperty('updatedAtUtc');
      expect(store.officeProfile()?.version).toBe(8);
    });

    it('sin perfil cargado no guarda (el PUT vaciaría lo que no se muestra)', () => {
      const { store, service } = setup();
      let failed = false;

      store.saveProfile(toCompanyProfile(RAW)).subscribe({ error: () => (failed = true) });

      expect(failed).toBe(true);
      expect(service.saveProfile).not.toHaveBeenCalled();
      expect(store.profileError()).not.toBeNull();
    });
  });

  describe('400 por campo', () => {
    it.each([
      ['Tenant.Profile.DisplayName', 'displayName'],
      ['Tenant.Profile.Ein', 'taxId'],
      ['Tenant.Profile.BusinessHours', 'hours'],
      ['Tenant.Profile.ReviewUrl', 'reviewUrl'],
    ])('%s queda atado al campo %s, no al aviso general', (code, field) => {
      const { store, service } = setup();
      store.loadProfile();
      service.saveProfile.mockReturnValue(badRequest(code, 'Invalid value.'));

      store.saveProfile(toCompanyProfile(RAW)).subscribe({ error: () => undefined });

      expect(store.fieldErrors()).toEqual({ [field]: 'Invalid value.' });
      expect(store.profileError()).toBeNull();
    });

    it('Tenant.Profile.State va a la postal si la física es válida', () => {
      const { store, service } = setup();
      store.loadProfile();
      service.saveProfile.mockReturnValue(badRequest('Tenant.Profile.State', 'Use the 2-letter US state code.'));

      store.saveProfile(toCompanyProfile(RAW)).subscribe({ error: () => undefined });

      expect(store.fieldErrors()).toEqual({ mailingState: 'Use the 2-letter US state code.' });
    });

    it('un código sin campo va al aviso de la sección y el error se borra al corregir', () => {
      const { store, service } = setup();
      store.loadProfile();
      service.saveProfile.mockReturnValue(badRequest('Tenant.Profile.Phone', 'Bad phone.'));
      store.saveProfile(toCompanyProfile(RAW)).subscribe({ error: () => undefined });
      store.clearFieldError('phone');
      expect(store.fieldErrors()).toEqual({});

      service.saveProfile.mockReturnValue(badRequest('Tenant.Unknown', 'Something else.'));
      store.saveProfile(toCompanyProfile(RAW)).subscribe({ error: () => undefined });
      expect(store.profileError()).toBe('Something else.');
      expect(store.officeProfile()).toEqual(RAW);
    });

    it('los códigos de Billing y de cumplimiento también van a su campo', () => {
      const { store, service } = setup();
      service.saveInvoiceSettings.mockReturnValue(badRequest('Billing.InvoiceSettings.InvoiceFooter', 'Too long.'));
      service.saveCompliance.mockReturnValue(badRequest('Tenant.Compliance.SecurityCoordinator', 'Not a user.'));

      store.saveInvoiceSettings(INVOICE).subscribe({ error: () => undefined });
      store.saveCompliance(COMPLIANCE_REQUEST).subscribe({ error: () => undefined });

      expect(store.fieldErrors()).toEqual({ invoiceFooter: 'Too long.', securityCoordinator: 'Not a user.' });
    });
  });

  describe('guardado en paralelo', () => {
    it('solo guarda las partes presentes', () => {
      const { store, service } = setup();
      store.loadAll({ office: true, invoice: true, compliance: true });
      let outcome: SaveOutcome | undefined;

      store.saveChanges({ invoice: { ...INVOICE, paymentTerms: 'Net30' } }).subscribe(o => (outcome = o));

      expect(service.saveInvoiceSettings).toHaveBeenCalledWith({ ...INVOICE, paymentTerms: 'Net30' });
      expect(service.saveProfile).not.toHaveBeenCalled();
      expect(service.saveOffice).not.toHaveBeenCalled();
      expect(service.saveCompliance).not.toHaveBeenCalled();
      expect(outcome).toEqual({ saved: ['invoice'], failed: [] });
      expect(store.invoiceSettings()?.paymentTerms).toBe('Net30');
    });

    it('un error parcial no corta al resto: lo guardado queda guardado', () => {
      const { store, service, auth } = setup();
      store.loadAll({ office: true, invoice: true, compliance: true });
      service.saveProfile.mockReturnValue(badRequest('Tenant.Profile.Ein', 'Bad EIN.'));
      let outcome: SaveOutcome | undefined;

      store
        .saveChanges({
          office: { name: 'Gutierrez Tax', defaultTimeZoneId: 'America/Chicago' },
          profile: { ...toCompanyProfile(RAW), taxId: '1' },
          compliance: COMPLIANCE_REQUEST,
        })
        .subscribe(o => (outcome = o));

      expect(outcome).toEqual({ saved: ['office', 'compliance'], failed: ['profile'] });
      expect(store.office()?.name).toBe('Gutierrez Tax');
      expect(auth.applyTenantName).toHaveBeenCalledWith('Gutierrez Tax');
      expect(store.compliance()?.retentionYears).toBe(5);
      expect(store.officeProfile()).toEqual(RAW);
      expect(store.fieldErrors()).toEqual({ taxId: 'Bad EIN.' });
      expect(store.saving()).toBe(false);
    });
  });

  describe('EFIN', () => {
    it('reveal muestra el EFIN y lo vuelve a ocultar solo', () => {
      vi.useFakeTimers();
      const { store, service } = setup();

      store.revealEfin();

      expect(service.revealEfin).toHaveBeenCalledTimes(1);
      expect(store.revealedEfin()).toBe('123423');
      vi.advanceTimersByTime(EFIN_REVEAL_MS);
      expect(store.revealedEfin()).toBeNull();
    });

    it('sin EFIN guardado (404) avisa en la sección', () => {
      const { store, service } = setup();
      service.revealEfin.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 404, error: { code: 'Tenant.Compliance.EfinNotSet', message: 'x' } })),
      );

      store.revealEfin();

      expect(store.revealedEfin()).toBeNull();
      expect(store.complianceError()).toBe('There is no EFIN on file.');
    });

    it('cambiar o quitar el EFIN oculta lo revelado', () => {
      const { store } = setup();
      store.revealEfin();

      store.saveCompliance({ ...COMPLIANCE_REQUEST, efin: '' }).subscribe();

      expect(store.revealedEfin()).toBeNull();
    });
  });
});
