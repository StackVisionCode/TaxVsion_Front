/**
 * Lectura de las marcas de tiempo del backend.
 *
 * Varios servicios (.NET sobre SQL Server) NO tienen configurado un conversor de
 * `DateTimeKind`, así que un `DateTime` leído de la base vuelve con
 * `Kind=Unspecified` y System.Text.Json lo serializa **sin la `Z` final**. Un
 * `new Date(...)` sobre ese string lo interpreta como hora LOCAL y la fecha
 * aparece corrida tantas horas como diga la zona del navegador.
 *
 * Servicios afectados hoy (verificado 2026-08-24): Notes, Signature, Communication,
 * Catalog, Inventory y Correspondence. Reminder, Tasks, Notification y Calendar sí
 * traen conversor. Como la convención del backend es que TODO campo `...Utc` viene
 * en UTC, aplicar esto es seguro incluso donde la `Z` ya viene puesta.
 */

/** Interpreta como UTC un instante del backend, tenga o no zona explícita. */
export function parseUtcDate(value: string): Date {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}

/** Igual que {@link parseUtcDate} pero tolera null/undefined/cadena vacía. */
export function parseUtcDateOrNull(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = parseUtcDate(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Milisegundos del instante, o null si no hay fecha válida (para comparaciones). */
export function utcTime(value: string | null | undefined): number | null {
  return parseUtcDateOrNull(value)?.getTime() ?? null;
}
