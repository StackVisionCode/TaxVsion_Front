import { describe, expect, it } from 'vitest';
import { OfficeProfile } from '../data-access/company-settings.model';
import { EMPTY_OFFICE_PROFILE, profileChanged, toCompanyProfile, toProfileRequest } from '../data-access/office-profile.mapper';
import { invoiceErrors, invoiceSettingsChanged, normalizeInvoiceSettings, paymentTermsLabel } from './invoice-settings-rules';
import { invoiceReadiness, profileErrors } from './profile-form';

/** Formulario del perfil (errores, mailing, cambios) y reglas de los ajustes de factura. */
describe('profile-form', () => {
  const LOADED: OfficeProfile = {
    ...EMPTY_OFFICE_PROFILE,
    legalName: 'Castillo Tax Services LLC',
    phone: '+1 202 555 0112',
    physicalAddress: { line1: '1600 Main St', line2: null, city: 'Austin', state: 'tx', postalCode: '78701', country: 'usa' },
    version: 3,
  };

  it('un perfil con formato viejo no aparece con cambios al cargarlo', () => {
    expect(profileChanged(LOADED, toCompanyProfile(LOADED))).toBe(false);
  });

  it('con "mailing is the same" la postal no viaja ni se valida', () => {
    const form = { ...toCompanyProfile(LOADED), mailing: { ...toCompanyProfile(LOADED).mailing, state: 'Texas' } };

    expect(profileErrors(form).mailingState).toBeUndefined();
    expect(toProfileRequest(LOADED, form).mailingAddress).toBeNull();
  });

  it('con la postal aparte se valida y viaja normalizada', () => {
    const base = toCompanyProfile(LOADED);
    const form = {
      ...base,
      mailingSameAsPhysical: false,
      mailing: { line1: 'PO Box 12', line2: '', city: 'Austin', state: 'tx', zip: '787021234', country: '' },
    };

    expect(profileErrors(form)).toEqual({});
    expect(toProfileRequest(LOADED, form)).toMatchObject({
      mailingSameAsPhysical: false,
      mailingAddress: { line1: 'PO Box 12', line2: null, city: 'Austin', state: 'TX', postalCode: '78702-1234', country: 'US' },
    });
    expect(profileErrors({ ...form, mailing: { ...form.mailing, zip: '7870' } }).mailingZip).toContain('ZIP');
  });

  it('el nombre legal vacío ya no es un error; el DBA con "IRS" sí', () => {
    const form = { ...toCompanyProfile(LOADED), name: '', displayName: 'IRS Help Desk' };

    expect(profileErrors(form)).toEqual({ displayName: expect.stringContaining('IRS') });
    expect(toProfileRequest(LOADED, form).legalName).toBeNull();
  });

  it('un horario inválido marca el campo de horario', () => {
    const form = toCompanyProfile(LOADED);
    form.hours = form.hours.map(d => (d.day === 'Monday' ? { ...d, open: true, opens: '18:00', closes: '09:00' } : d));

    expect(profileErrors(form).hours).toBeTruthy();
  });

  it('el chequeo recomienda el nombre legal sin exigirlo', () => {
    const checks = invoiceReadiness(toCompanyProfile({ ...LOADED, legalName: null }));

    expect(checks.find(c => c.id === 'name')?.done).toBe(false);
    expect(checks.find(c => c.id === 'address')?.done).toBe(true);
  });

  it('ajustes de factura: textos vacíos como null, tope de 500 y etiqueta del plazo', () => {
    expect(normalizeInvoiceSettings({ paymentTerms: 'Net30', paymentInstructions: '  ', invoiceFooter: ' Thanks ' })).toEqual({
      paymentTerms: 'Net30',
      paymentInstructions: null,
      invoiceFooter: 'Thanks',
    });
    expect(invoiceErrors({ paymentTerms: 'Net7', paymentInstructions: 'a'.repeat(501), invoiceFooter: null })).toEqual({
      paymentInstructions: expect.stringContaining('500'),
    });
    expect(
      invoiceSettingsChanged(
        { paymentTerms: 'Net7', paymentInstructions: '', invoiceFooter: null },
        { paymentTerms: 'Net7', paymentInstructions: null, invoiceFooter: null },
      ),
    ).toBe(false);
    expect(paymentTermsLabel('Net45')).toBe('Net 45');
  });
});
