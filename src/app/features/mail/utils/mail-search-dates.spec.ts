import { describe, expect, it } from 'vitest';
import { customRangeLabel, isValidDay, mailDateRangeUtc } from './mail-search-dates';

describe('mailDateRangeUtc', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');

  it('presets: desde ahora menos N días, sin `toUtc`; "any" sin rango', () => {
    expect(mailDateRangeUtc('any', null, null, now)).toEqual({});
    expect(mailDateRangeUtc('7d', null, null, now)).toEqual({ fromUtc: '2026-10-27T12:00:00.000Z' });
    expect(mailDateRangeUtc('30d', null, null, now)).toEqual({ fromUtc: '2026-10-04T12:00:00.000Z' });
    expect(mailDateRangeUtc('90d', null, null, now)).toEqual({ fromUtc: '2026-08-05T12:00:00.000Z' });
  });

  it('personalizado: día local completo (00:00 a 23:59:59.999), extremos opcionales', () => {
    expect(mailDateRangeUtc('custom', '2026-10-01', '2026-10-31')).toEqual({
      fromUtc: new Date(2026, 9, 1).toISOString(),
      toUtc: new Date(2026, 9, 31, 23, 59, 59, 999).toISOString(),
    });
    expect(mailDateRangeUtc('custom', '2026-10-01', null)).toEqual({ fromUtc: new Date(2026, 9, 1).toISOString() });
    expect(mailDateRangeUtc('custom', null, 'basura')).toEqual({});
  });
});

describe('isValidDay / customRangeLabel', () => {
  it('valida días reales', () => {
    expect(isValidDay('2026-02-28')).toBe(true);
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('10/01/2026')).toBe(false);
    expect(isValidDay(null)).toBe(false);
  });

  it('etiqueta el rango en inglés', () => {
    expect(customRangeLabel('2026-10-01', '2026-10-31')).toBe('Oct 1 – Oct 31, 2026');
    expect(customRangeLabel('2025-12-20', '2026-01-05')).toBe('Dec 20, 2025 – Jan 5, 2026');
    expect(customRangeLabel('2026-10-01', null)).toBe('From Oct 1, 2026');
    expect(customRangeLabel(null, '2026-10-31')).toBe('Until Oct 31, 2026');
    expect(customRangeLabel(null, null)).toBe('Custom range');
  });
});
