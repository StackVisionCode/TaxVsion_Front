/**
 * Rango de fechas de la búsqueda de Mail → `fromUtc`/`toUtc` (ISO UTC, inclusivos). Presets relativos a
 * "ahora" (sin `toUtc`); el personalizado usa días del calendario LOCAL del usuario (00:00 a 23:59:59.999).
 */

export type MailDatePreset = 'any' | '7d' | '30d' | '90d' | 'custom';

export const MAIL_DATE_PRESET_DAYS: Readonly<Record<'7d' | '30d' | '90d', number>> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export interface MailDateRangeUtc {
  fromUtc?: string;
  toUtc?: string;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` válido → fecha local a medianoche; otra cosa → null. */
export function parseLocalDay(value: string | null | undefined): Date | null {
  const match = ISO_DAY.exec(value ?? '');
  if (!match) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** ¿Es un día `YYYY-MM-DD` real? */
export function isValidDay(value: string | null | undefined): boolean {
  return parseLocalDay(value) !== null;
}

export function mailDateRangeUtc(
  preset: MailDatePreset,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  now: number = Date.now(),
): MailDateRangeUtc {
  if (preset === 'custom') {
    const from = parseLocalDay(dateFrom);
    const to = parseLocalDay(dateTo);
    const range: MailDateRangeUtc = {};
    if (from) range.fromUtc = from.toISOString();
    if (to) {
      to.setHours(23, 59, 59, 999);
      range.toUtc = to.toISOString();
    }
    return range;
  }
  if (preset === 'any') {
    return {};
  }
  return { fromUtc: new Date(now - MAIL_DATE_PRESET_DAYS[preset] * 24 * 60 * 60 * 1000).toISOString() };
}

/** Etiqueta corta del rango personalizado ("Oct 1 – Oct 31, 2026", "From Oct 1", "Until Oct 31"). */
export function customRangeLabel(dateFrom: string | null | undefined, dateTo: string | null | undefined): string {
  const from = parseLocalDay(dateFrom);
  const to = parseLocalDay(dateTo);
  const day = (date: Date, withYear: boolean) =>
    date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
  if (from && to) {
    return `${day(from, from.getFullYear() !== to.getFullYear())} – ${day(to, true)}`;
  }
  if (from) return `From ${day(from, true)}`;
  if (to) return `Until ${day(to, true)}`;
  return 'Custom range';
}
