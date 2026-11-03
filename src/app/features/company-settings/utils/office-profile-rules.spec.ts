import { describe, expect, it } from 'vitest';
import {
  displayNameError,
  einError,
  fieldForCode,
  emailError,
  formatEinInput,
  legalNameError,
  normalizeCountry,
  normalizeEin,
  normalizePhone,
  normalizeWebsite,
  normalizeZip,
  phoneError,
  linkError,
  stateError,
  websiteError,
  zipError,
} from './office-profile-rules';

/** Mismas reglas que valida Tenant en el perfil: vacío vale, solo se rechaza lo mal formado. */
describe('office-profile-rules', () => {
  it('EIN: se formatea al escribir y acepta 9 dígitos con o sin guion', () => {
    expect(formatEinInput('12')).toBe('12');
    expect(formatEinInput('123')).toBe('12-3');
    expect(formatEinInput('12a34567890')).toBe('12-3456789');
    expect(einError('')).toBeNull();
    expect(einError('123456789')).toBeNull();
    expect(einError('12-345')).not.toBeNull();
    expect(normalizeEin('123456789')).toBe('12-3456789');
  });

  it('correo: vacío vale; sin dominio con punto no', () => {
    expect(emailError(null)).toBeNull();
    expect(emailError('office@yourfirm.com')).toBeNull();
    expect(emailError('office@yourfirm')).not.toBeNull();
    expect(emailError('office team@yourfirm.com')).not.toBeNull();
  });

  it('web: sin esquema se antepone https y solo vale http(s) con dominio', () => {
    expect(normalizeWebsite('yourfirm.com')).toBe('https://yourfirm.com');
    expect(normalizeWebsite('http://yourfirm.com')).toBe('http://yourfirm.com');
    expect(websiteError('yourfirm.com')).toBeNull();
    expect(websiteError('ftp://yourfirm.com')).not.toBeNull();
    expect(websiteError('yourfirm')).not.toBeNull();
  });

  it('teléfono: 10 a 15 dígitos; EE. UU. en formato nacional, el resto internacional', () => {
    expect(phoneError('555-1234')).not.toBeNull();
    expect(phoneError('555 123 4567 ext 2')).not.toBeNull();
    expect(normalizePhone('+1 555 123 4567')).toBe('(555) 123-4567');
    expect(normalizePhone('5551234567')).toBe('(555) 123-4567');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('estado y ZIP solo se validan cuando el país es EE. UU.', () => {
    expect(stateError('tx', 'usa')).toBeNull();
    expect(stateError('Texas', 'US')).not.toBeNull();
    expect(stateError('Greater London', 'GB')).toBeNull();
    expect(zipError('78701-1234', 'US')).toBeNull();
    expect(zipError('7870', 'US')).not.toBeNull();
    expect(zipError('SW1A 2AA', 'GB')).toBeNull();
    expect(normalizeZip('787011234', 'US')).toBe('78701-1234');
  });

  it('país: las formas habituales de EE. UU. y el vacío quedan en US', () => {
    expect(normalizeCountry('')).toBe('US');
    expect(normalizeCountry('United States')).toBe('US');
    expect(normalizeCountry('gb')).toBe('GB');
  });

  it('nombre legal: opcional y como máximo 200 caracteres', () => {
    expect(legalNameError('  ')).toBeNull();
    expect(legalNameError('A'.repeat(200))).toBeNull();
    expect(legalNameError('A'.repeat(201))).toContain('200 characters');
  });

  it('DBA: "IRS" solo se rechaza como palabra suelta, igual que Tenant', () => {
    expect(displayNameError('')).toBeNull();
    expect(displayNameError('Castillo Tax')).toBeNull();
    expect(displayNameError('IRS Tax Help')).toContain('IRS');
    expect(displayNameError('fast irs refunds')).toContain('IRS');
    expect(displayNameError('Internal  Revenue Service Pros')).toContain('IRS');
    expect(displayNameError('FIRST Tax')).toBeNull();
    expect(displayNameError('A'.repeat(201))).toContain('200 characters');
  });

  it('enlaces (citas/reseñas): http(s) con dominio y tope propio', () => {
    expect(linkError('calendly.com/castillo', 512, 'bad')).toBeNull();
    expect(linkError('ftp://calendly.com', 512, 'bad')).toBe('bad');
    expect(linkError('https://x.co/' + 'a'.repeat(600), 512, 'bad')).toBe('bad');
  });

  it('códigos 400 de los tres backends: cada uno a su campo, con o sin sufijo', () => {
    expect(fieldForCode('Tenant.Profile.LegalName')).toBe('name');
    expect(fieldForCode('Tenant.Profile.DisplayName')).toBe('displayName');
    expect(fieldForCode('Tenant.Profile.EntityType')).toBe('entityType');
    expect(fieldForCode('Tenant.Profile.Ein')).toBe('taxId');
    expect(fieldForCode('Tenant.Profile.State')).toBe('state');
    expect(fieldForCode('Tenant.Profile.PostalCode')).toBe('zip');
    expect(fieldForCode('Tenant.Profile.Language')).toBe('language');
    expect(fieldForCode('Tenant.Profile.BusinessHours')).toBe('hours');
    expect(fieldForCode('Tenant.Profile.BookingUrl')).toBe('bookingUrl');
    expect(fieldForCode('Tenant.Compliance.Efin')).toBe('efin');
    expect(fieldForCode('Tenant.Compliance.IncidentContactPhone')).toBe('incidentPhone');
    expect(fieldForCode('Tenant.Compliance.RetentionYears')).toBe('retentionYears');
    expect(fieldForCode('Billing.InvoiceSettings.InvoiceFooter')).toBe('invoiceFooter');
    expect(fieldForCode('Tenant.Profile.Ein.Invalid')).toBe('taxId');
  });

  it('códigos sin campo no se atan a ninguno', () => {
    expect(fieldForCode('Tenant.Profile.EinX')).toBeNull();
    expect(fieldForCode('Tenant.Compliance.EfinNotSet')).toBeNull();
    expect(fieldForCode('Billing.TaxId.Invalid')).toBeNull();
    expect(fieldForCode(null)).toBeNull();
  });
});
