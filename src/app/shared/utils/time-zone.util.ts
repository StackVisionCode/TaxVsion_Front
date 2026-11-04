/**
 * Zonas horarias IANA para un selector: primero las de EE. UU. (las oficinas son de allí), luego todas
 * las demás que conoce el navegador. Sin `Intl.supportedValuesOf` (navegadores viejos) quedan solo las de
 * EE. UU. y la actual.
 */

export interface TimeZoneOption {
  id: string;
  label: string;
}

export interface TimeZoneGroups {
  us: TimeZoneOption[];
  others: TimeZoneOption[];
}

export const US_TIME_ZONES: readonly TimeZoneOption[] = [
  { id: 'America/New_York', label: 'Eastern Time (New York)' },
  { id: 'America/Chicago', label: 'Central Time (Chicago)' },
  { id: 'America/Denver', label: 'Mountain Time (Denver)' },
  { id: 'America/Phoenix', label: 'Mountain Time – Arizona (Phoenix)' },
  { id: 'America/Los_Angeles', label: 'Pacific Time (Los Angeles)' },
  { id: 'America/Anchorage', label: 'Alaska Time (Anchorage)' },
  { id: 'Pacific/Honolulu', label: 'Hawaii Time (Honolulu)' },
  { id: 'America/Puerto_Rico', label: 'Atlantic Time (Puerto Rico)' },
];

/** "America/Santo_Domingo" → "America / Santo Domingo". */
export function timeZoneLabel(id: string): string {
  const us = US_TIME_ZONES.find(z => z.id === id);
  return us ? us.label : id.replace(/_/g, ' ').split('/').join(' / ');
}

function supportedTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: 'timeZone') => string[] };
  try {
    return intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}

/** Grupos para el `<select>`. `current` se agrega si el navegador no lo lista (p. ej. "Etc/UTC"). */
export function buildTimeZoneGroups(current?: string | null): TimeZoneGroups {
  const usIds = new Set(US_TIME_ZONES.map(z => z.id));
  const others = new Set(supportedTimeZones().filter(id => !usIds.has(id)));
  if (current && !usIds.has(current)) {
    others.add(current);
  }
  return {
    us: [...US_TIME_ZONES],
    others: [...others].sort((a, b) => a.localeCompare(b)).map(id => ({ id, label: timeZoneLabel(id) })),
  };
}
