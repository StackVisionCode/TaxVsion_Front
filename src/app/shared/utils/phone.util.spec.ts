import { formatPhoneForDisplay, isValidPhone, normalizePhoneToApi } from './phone.util';

describe('phone.util', () => {
  it('normalizePhoneToApi deja + inicial y dígitos', () => {
    expect(normalizePhoneToApi(' +1 (809) 555-1234 ')).toBe('+18095551234');
    expect(normalizePhoneToApi('809+555')).toBe('809555');
    expect(normalizePhoneToApi(null)).toBe('');
  });

  it('isValidPhone exige E.164 (vacío es válido)', () => {
    expect(isValidPhone('')).toBe(true);
    expect(isValidPhone('+1 809 555 1234')).toBe(true);
    expect(isValidPhone('8095551234')).toBe(false);
  });

  it('formatPhoneForDisplay formatea US y deja el resto', () => {
    expect(formatPhoneForDisplay('+18095551234')).toBe('+1 (809) 555-1234');
    expect(formatPhoneForDisplay('+34600111222')).toBe('+34600111222');
    expect(formatPhoneForDisplay(undefined)).toBe('');
  });
});
