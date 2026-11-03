import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminCapabilities } from '@core/access/admin-capabilities';
import { AccessStore } from '@core/access/access.store';
import { AuthService } from '@core/auth/auth.service';
import { StaffDirectoryStore } from '@core/staff/staff-directory.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import {
  InvoiceSettings,
  OfficeCompliance,
  OfficeIdentity,
  OfficeProfile,
} from '../../data-access/company-settings.model';
import { CompanySettingsStore, SaveOutcome } from '../../data-access/company-settings.store';
import { CompanyBrandStore } from '../../data-access/company-brand.store';
import { EMPTY_OFFICE_PROFILE } from '../../data-access/office-profile.mapper';
import { CompanySettingsPageComponent } from './company-settings-page.component';

/** Lógica de la página: permisos reales, borradores, validación en línea y guardado en paralelo. */
describe('CompanySettingsPageComponent', () => {
  const PROFILE: OfficeProfile = {
    ...EMPTY_OFFICE_PROFILE,
    legalName: 'Castillo Tax Services LLC',
    ein: '12-3456789',
    phone: '+1 202 555 0112',
    email: 'office@castillotax.com',
    physicalAddress: { line1: '1600 Main St', line2: null, city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
    businessHours: [{ day: 'Monday', opens: '09:00', closes: '18:00' }],
    version: 2,
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

  interface Perms {
    settings?: boolean;
    branding?: boolean;
    invoicingView?: boolean;
    invoicingManage?: boolean;
    admin?: boolean;
  }

  function setup(perms: Perms = {}) {
    const { settings = true, branding = true, invoicingView = true, invoicingManage = true, admin = true } = perms;
    const compliance = admin && settings;
    const store = {
      officeProfile: signal<OfficeProfile | null>(PROFILE),
      office: signal<OfficeIdentity | null>(settings ? OFFICE : null),
      invoiceSettings: signal<InvoiceSettings | null>(invoicingView ? INVOICE : null),
      compliance: signal<OfficeCompliance | null>(compliance ? COMPLIANCE : null),
      profileLoading: signal(false),
      officeLoading: signal(false),
      invoiceLoading: signal(false),
      complianceLoading: signal(false),
      saving: signal(false),
      profileError: signal<string | null>(null),
      officeError: signal<string | null>(null),
      invoiceError: signal<string | null>(null),
      complianceError: signal<string | null>(null),
      fieldErrors: signal<Record<string, string>>({}),
      revealedEfin: signal<string | null>(null),
      revealingEfin: signal(false),
      loadAll: vi.fn(),
      saveChanges: vi.fn(() => of<SaveOutcome>({ saved: ['profile'], failed: [] })),
      clearFieldError: vi.fn(),
      clearSaveErrors: vi.fn(),
      revealEfin: vi.fn(),
      hideEfin: vi.fn(),
    };
    const brand = { surface: signal('Crm'), logo: signal(null), loadBrand: vi.fn() };
    const staff = {
      assignable: signal([{ userId: 'u-1', name: 'Ana Castillo', email: 'ana@castillo.com' }]),
      ensureLoaded: vi.fn(),
    };
    const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({
      imports: [CompanySettingsPageComponent],
      providers: [
        { provide: CompanySettingsStore, useValue: store },
        { provide: CompanyBrandStore, useValue: brand },
        { provide: StaffDirectoryStore, useValue: staff },
        { provide: AccessStore, useValue: { can: () => true } },
        {
          provide: AdminCapabilities,
          useValue: {
            canManageOfficeProfile: signal(settings),
            canManageSettings: signal(settings),
            canManageBranding: signal(branding),
            canViewInvoices: signal(invoicingView),
            canManageInvoiceSettings: signal(invoicingManage),
            canManageCompliance: signal(compliance),
          },
        },
        { provide: AuthService, useValue: { currentUser: signal({ tenant: { name: 'Nexora' } }) } },
        { provide: ToastService, useValue: toast },
      ],
    });
    // Solo la lógica: las secciones tienen sus propios specs.
    TestBed.overrideComponent(CompanySettingsPageComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(CompanySettingsPageComponent);
    fixture.detectChanges();
    return { page: fixture.componentInstance, store, staff, toast, fixture };
  }

  afterEach(() => TestBed.resetTestingModule());

  describe('permisos', () => {
    it('sin settings.manage: solo lectura y no pide oficina ni cumplimiento (evita el 403)', () => {
      const { page, store } = setup({ settings: false });
      page.patchProfile({ website: 'castillotax.com' });

      expect(store.loadAll).toHaveBeenCalledWith({ office: false, invoice: true, compliance: false });
      expect(page.canEditProfile()).toBe(false);
      expect(page.sections().map(s => s.id)).not.toContain('compliance');
      expect(page.showSaveBar()).toBe(false);
    });

    it('compliance se oculta y no se carga para quien no es TenantAdmin', () => {
      const { page, store, staff } = setup({ admin: false });

      expect(page.showCompliance()).toBe(false);
      expect(store.loadAll).toHaveBeenCalledWith({ office: true, invoice: true, compliance: false });
      expect(page.sections().map(s => s.id)).not.toContain('compliance');
      expect(staff.ensureLoaded).not.toHaveBeenCalled();
    });

    it('TenantAdmin ve cumplimiento y se carga el equipo para el responsable', () => {
      const { page, staff } = setup();

      expect(page.sections().map(s => s.id)).toEqual([
        'office', 'identity', 'address', 'experience', 'invoicing', 'preview', 'compliance', 'brand',
      ]);
      expect(staff.ensureLoaded).toHaveBeenCalled();
      expect(page.coordinatorOptions()).toEqual([{ userId: 'u-1', label: 'Ana Castillo · ana@castillo.com' }]);
    });

    it('sin invoicing.view la sección de factura ni se carga ni se muestra; sin issuer.manage es de solo lectura', () => {
      const hidden = setup({ invoicingView: false });
      expect(hidden.store.loadAll).toHaveBeenCalledWith({ office: true, invoice: false, compliance: true });
      expect(hidden.page.sections().map(s => s.id)).not.toContain('invoicing');
      expect(hidden.page.previewTerms()).toBeNull();
      TestBed.resetTestingModule();

      const readOnly = setup({ invoicingManage: false });
      readOnly.page.patchInvoice({ ...INVOICE, paymentTerms: 'Net30' });
      expect(readOnly.page.canEditInvoice()).toBe(false);
      expect(readOnly.page.showSaveBar()).toBe(false);
    });
  });

  describe('perfil', () => {
    it('recién cargado (aunque el formato guardado sea viejo) no hay cambios', () => {
      const { page } = setup();

      expect(page.profileDirty()).toBe(false);
      expect(page.showSaveBar()).toBe(false);
    });

    it('el nombre legal ya no es obligatorio: vaciarlo se puede guardar', () => {
      const { page, store } = setup();

      page.patchProfile({ name: '   ' });
      page.saveAll();

      expect(page.canSave()).toBe(true);
      expect(store.saveChanges).toHaveBeenCalledWith(expect.objectContaining({ profile: expect.objectContaining({ name: '   ' }) }));
    });

    it('un DBA con "IRS" no llega al backend y se muestra en su campo', () => {
      const { page, store } = setup();

      page.patchProfile({ displayName: 'IRS Help Desk' });
      page.saveAll();

      expect(store.saveChanges).not.toHaveBeenCalled();
      expect(page.errors().displayName).toContain('IRS');
      expect(page.saveBlockedReason()).toBe('Fix the highlighted fields to save');
    });

    it('un error de formato se muestra al salir del campo, y al salir se normaliza lo válido', () => {
      const { page } = setup();
      page.patchProfile({ email: 'office@castillo' });
      expect(page.errors().email).toBeUndefined();
      page.onBlur('email');
      expect(page.errors().email).toContain('valid email');

      page.patchProfile({ bookingUrl: 'calendly.com/castillo' });
      page.onBlur('bookingUrl');
      expect(page.profileDraft().bookingUrl).toBe('https://calendly.com/castillo');
    });

    it('apagar "mailing is the same" deja la postal pendiente y su ZIP se valida', () => {
      const { page } = setup();

      page.patchProfile({ mailingSameAsPhysical: false });
      expect(page.profileDirty()).toBe(true);

      page.patchProfile({ mailing: { ...page.profileDraft().mailing, zip: '123' } });
      page.onBlur('mailingZip');
      expect(page.errors().mailingZip).toContain('ZIP');
      expect(page.errors().zip).toBeUndefined();
    });

    it('un horario con cierre antes de la apertura bloquea el guardado', () => {
      const { page, store } = setup();
      const hours = page.profileDraft().hours.map(d => (d.day === 'Monday' ? { ...d, closes: '08:00' } : d));

      page.patchProfile({ hours });
      page.saveAll();

      expect(store.saveChanges).not.toHaveBeenCalled();
      expect(page.submitAttempted()).toBe(true);
    });

    it('muestra junto al campo el 400 del backend y lo borra al editar ese campo', () => {
      const { page, store } = setup();
      store.fieldErrors.set({ taxId: 'The EIN must have 9 digits, like 12-3456789.' });

      expect(page.errors().taxId).toContain('9 digits');
      page.patchProfile({ taxId: '98-7654321' });
      expect(store.clearFieldError).toHaveBeenCalledWith('taxId');
    });

    it('el chequeo recomienda el nombre legal sin bloquear nada', () => {
      const { page, store } = setup();
      store.officeProfile.set({ ...PROFILE, legalName: null });

      expect(page.readinessChecks().filter(c => !c.done).map(c => c.id)).toEqual(['name']);
      expect(page.readinessScore()).toBe(75);
    });
  });

  describe('guardado en paralelo', () => {
    it('manda solo las partes con cambios', () => {
      const { page, store, toast } = setup();
      store.saveChanges.mockReturnValue(of({ saved: ['office', 'invoice'], failed: [] }));

      page.patchOffice({ name: ' Gutierrez Tax ', defaultTimeZoneId: 'America/Chicago' });
      page.patchInvoice({ paymentTerms: 'Net30', paymentInstructions: '', invoiceFooter: ' Thanks! ' });
      page.saveAll();

      expect(store.saveChanges).toHaveBeenCalledWith({
        office: { name: 'Gutierrez Tax', defaultTimeZoneId: 'America/Chicago' },
        profile: undefined,
        invoice: { paymentTerms: 'Net30', paymentInstructions: null, invoiceFooter: 'Thanks!' },
        compliance: undefined,
      });
      expect(toast.success).toHaveBeenCalledWith('Office details saved');
    });

    it('quitar el EFIN viaja como "" en el PUT de cumplimiento', () => {
      const { page, store } = setup();

      page.patchCompliance({ ...page.complianceDraft(), efinAction: 'clear' });
      page.saveAll();

      expect(store.saveChanges).toHaveBeenCalledWith(
        expect.objectContaining({ compliance: expect.objectContaining({ efin: '' }) }),
      );
    });

    it('con error parcial avisa y no anuncia éxito', () => {
      const { page, store, toast } = setup();
      store.saveChanges.mockReturnValue(of({ saved: ['office'], failed: ['profile'] }));

      page.patchOffice({ name: 'Gutierrez Tax', defaultTimeZoneId: 'Etc/UTC' });
      page.patchProfile({ phone: '(512) 555-0100' });
      page.saveAll();

      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Some changes were saved. Fix the highlighted fields and try again.');
    });

    it('el nombre de la oficina es obligatorio', () => {
      const { page } = setup();

      page.patchOffice({ name: ' ', defaultTimeZoneId: 'Etc/UTC' });

      expect(page.errors().officeName).toBe('The office name is required.');
      expect(page.canSave()).toBe(false);
      expect(page.saveBlockedReason()).toBe('Add the office name to save');
    });

    it('descartar restaura todo y olvida los errores del guardado', () => {
      const { page, store } = setup();
      page.patchOffice({ name: 'Other', defaultTimeZoneId: 'Etc/UTC' });
      page.patchProfile({ displayName: 'Castillo & Co', mailingSameAsPhysical: false });
      page.patchInvoice({ ...INVOICE, invoiceFooter: 'Thanks' });
      page.patchCompliance({ ...page.complianceDraft(), efinAction: 'change', efin: '12' });

      page.discardAll();

      expect(page.showSaveBar()).toBe(false);
      expect(page.officeDraft()?.name).toBe('Castillo Tax');
      expect(page.profileDraft().mailingSameAsPhysical).toBe(true);
      expect(page.complianceDraft().efinAction).toBe('keep');
      expect(store.clearSaveErrors).toHaveBeenCalled();
    });

    it('lo guardado vuelve a su borrador al responder el backend', () => {
      const { page, store, fixture } = setup();
      page.patchInvoice({ ...INVOICE, paymentTerms: 'Net15' });

      store.invoiceSettings.set({ ...INVOICE, paymentTerms: 'Net15' });
      fixture.detectChanges();

      expect(page.invoiceDirty()).toBe(false);
      expect(page.previewTerms()).toBe('Net 15');
    });
  });

  it('la cabecera muestra el nombre visible de la oficina', () => {
    const { page } = setup();

    expect(page.officeName()).toBe('Castillo Tax');
  });
});
