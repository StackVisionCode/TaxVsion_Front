import { FALLBACK_CURRENCY, normalizeCurrency } from './office-currency.store';

describe('normalizeCurrency (item 6.1)', () => {
  it('normaliza códigos ISO-4217', () => {
    expect(normalizeCurrency(' eur ')).toBe('EUR');
    expect(normalizeCurrency('DOP')).toBe('DOP');
  });

  it('rechaza valores vacíos o inválidos', () => {
    expect(normalizeCurrency(null)).toBeNull();
    expect(normalizeCurrency('')).toBeNull();
    expect(normalizeCurrency('US')).toBeNull();
    expect(normalizeCurrency('US$')).toBeNull();
  });

  it('el fallback es un código válido', () => {
    expect(normalizeCurrency(FALLBACK_CURRENCY)).toBe(FALLBACK_CURRENCY);
  });
});
