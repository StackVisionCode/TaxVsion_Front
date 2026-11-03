import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTimeZoneGroups, timeZoneLabel, US_TIME_ZONES } from './time-zone.util';

describe('time-zone.util', () => {
  afterEach(() => vi.restoreAllMocks());

  it('las zonas de EE. UU. van primero y no se repiten en el resto', () => {
    const groups = buildTimeZoneGroups();

    expect(groups.us.map(z => z.id)).toEqual(US_TIME_ZONES.map(z => z.id));
    expect(groups.others.some(z => z.id === 'America/New_York')).toBe(false);
  });

  it('agrega la zona actual aunque el navegador no la liste', () => {
    const groups = buildTimeZoneGroups('Etc/UTC');

    expect(groups.others.some(z => z.id === 'Etc/UTC')).toBe(true);
  });

  it('sin supportedValuesOf quedan las de EE. UU. y la actual', () => {
    vi.spyOn(Intl as unknown as { supportedValuesOf: () => string[] }, 'supportedValuesOf').mockImplementation(() => {
      throw new Error('unsupported');
    });

    const groups = buildTimeZoneGroups('Europe/Madrid');

    expect(groups.others).toEqual([{ id: 'Europe/Madrid', label: 'Europe / Madrid' }]);
  });

  it('etiqueta legible para las de EE. UU. y para el resto', () => {
    expect(timeZoneLabel('America/Chicago')).toBe('Central Time (Chicago)');
    expect(timeZoneLabel('America/Santo_Domingo')).toBe('America / Santo Domingo');
  });
});
