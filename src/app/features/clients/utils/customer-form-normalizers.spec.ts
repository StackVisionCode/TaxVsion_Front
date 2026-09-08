import { describe, expect, it } from 'vitest';
import {
  bitmaskToPurposes,
  formatEinForDisplay,
  formatPhoneForDisplay,
  formatSsnForDisplay,
  hasPurpose,
  isFutureDate,
  isValidEmail,
  isValidPhone,
  isValidTaxIdentifier,
  normalizeEmailToApi,
  normalizePhoneToApi,
  purposesToBitmask,
  serializeDateOnly,
  taxIdentifierDigits,
} from './customer-form-normalizers';

describe('phone (PhoneNumber VO: strip to +/digits, ^\\+[1-9]\\d{6,14}$)', () => {
  it('normaliza descartando formato humano', () => {
    expect(normalizePhoneToApi('(809) 555-1234')).toBe('8095551234');
    expect(normalizePhoneToApi('+1 809 555 1234')).toBe('+18095551234');
    expect(normalizePhoneToApi('+52-55-1234-5678')).toBe('+525512345678');
  });
  it('rechaza sin país / inválidos', () => {
    expect(isValidPhone('(809) 555-1234')).toBe(false); // sin '+'
    expect(isValidPhone('+0123456789')).toBe(false); // empieza en 0
    expect(isValidPhone('+123')).toBe(false); // muy corto
  });
  it('acepta E.164 válido y trata vacío como válido (opcional)', () => {
    expect(isValidPhone('+18095551234')).toBe(true);
    expect(isValidPhone('+525512345678')).toBe(true);
    expect(isValidPhone('')).toBe(true);
    expect(isValidPhone(null)).toBe(true);
  });
  it('formatea US para display; deja otros E.164 igual', () => {
    expect(formatPhoneForDisplay('+18095551234')).toBe('+1 (809) 555-1234');
    expect(formatPhoneForDisplay('+525512345678')).toBe('+525512345678');
    expect(formatPhoneForDisplay('')).toBe('');
  });
});

describe('email (EmailAddress VO: trim, <=254, @ no en extremos)', () => {
  it('normaliza con trim', () => {
    expect(normalizeEmailToApi('  A@b.co ')).toBe('A@b.co');
  });
  it('valida presencia de @ y longitud', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('bad')).toBe(false);
    expect(isValidEmail('@x')).toBe(false);
    expect(isValidEmail('x@')).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('a@' + 'x'.repeat(255))).toBe(false);
  });
});

describe('tax identifier (SubjectKind decide; 9 dígitos; SSN no 000/666)', () => {
  it('solo dígitos', () => {
    expect(taxIdentifierDigits('123-45-6789')).toBe('123456789');
  });
  it('SSN/ITIN válido salvo prefijo 000/666', () => {
    expect(isValidTaxIdentifier('123-45-6789', 'Individual')).toBe(true);
    expect(isValidTaxIdentifier('000-11-2222', 'Individual')).toBe(false);
    expect(isValidTaxIdentifier('666-11-2222', 'Individual')).toBe(false);
    expect(isValidTaxIdentifier('12-345', 'Individual')).toBe(false);
  });
  it('EIN: 9 dígitos sin regla de prefijo', () => {
    expect(isValidTaxIdentifier('66-6112222', 'Business')).toBe(true);
    expect(isValidTaxIdentifier('12-3456789', 'Business')).toBe(true);
    expect(isValidTaxIdentifier('12345', 'Business')).toBe(false);
  });
  it('formatea SSN/EIN progresivamente', () => {
    expect(formatSsnForDisplay('12345')).toBe('123-45');
    expect(formatSsnForDisplay('123456789')).toBe('123-45-6789');
    expect(formatEinForDisplay('123456789')).toBe('12-3456789');
  });
});

describe('DateOnly (yyyy-MM-dd, sin timezone)', () => {
  it('serializa tal cual o null', () => {
    expect(serializeDateOnly('1990-05-04')).toBe('1990-05-04');
    expect(serializeDateOnly('')).toBe(null);
    expect(serializeDateOnly(null)).toBe(null);
  });
  it('detecta fecha futura', () => {
    expect(isFutureDate('1990-01-01')).toBe(false);
    expect(isFutureDate('2999-01-01')).toBe(true);
    expect(isFutureDate(null)).toBe(false);
  });
});

describe('RelationPurpose bitmask', () => {
  it('combina y descompone', () => {
    expect(purposesToBitmask([1, 2])).toBe(3);
    expect(purposesToBitmask([])).toBe(0);
    expect(bitmaskToPurposes(3, [1, 2, 4, 8, 16, 32])).toEqual([1, 2]);
    expect(hasPurpose(3, 2)).toBe(true);
    expect(hasPurpose(3, 4)).toBe(false);
    expect(hasPurpose(0, 0)).toBe(false);
  });
});
