import { DayHoursForm, OfficeBusinessHours, WEEK_DAYS } from '../data-access/company-settings.model';

/**
 * Editor semanal del horario: un tramo por día (como Tenant), lunes primero. Un día cerrado no viaja en
 * `businessHours`; al abrirlo propone el horario típico de oficina.
 */

export const DEFAULT_OPENS = '09:00';
export const DEFAULT_CLOSES = '17:00';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Días hábiles a los que "Copy Monday to weekdays" copia el lunes. */
const WEEKDAYS = new Set(['Tuesday', 'Wednesday', 'Thursday', 'Friday']);

/** `businessHours` del perfil → los 7 días del editor (los que faltan quedan cerrados). */
export function toHoursForm(hours: readonly OfficeBusinessHours[] | null | undefined): DayHoursForm[] {
  const byDay = new Map((hours ?? []).map(h => [h.day.toLowerCase(), h]));
  return WEEK_DAYS.map(day => {
    const saved = byDay.get(day.toLowerCase());
    return saved
      ? { day, open: true, opens: saved.opens, closes: saved.closes }
      : { day, open: false, opens: DEFAULT_OPENS, closes: DEFAULT_CLOSES };
  });
}

/** Editor → `businessHours` (solo los días abiertos, en orden). */
export function toBusinessHours(form: readonly DayHoursForm[]): OfficeBusinessHours[] {
  return form.filter(d => d.open).map(d => ({ day: d.day, opens: d.opens, closes: d.closes }));
}

/** Error de un día abierto: hora en `HH:mm` y cierre posterior a la apertura. */
export function dayHoursError(day: DayHoursForm): string | null {
  if (!day.open) return null;
  if (!TIME_PATTERN.test(day.opens) || !TIME_PATTERN.test(day.closes)) return 'Enter both times, like 09:00.';
  return day.closes > day.opens ? null : 'Closing time must be after opening time.';
}

/** Días con error → mensaje (vacío = horario válido). */
export function hoursErrors(form: readonly DayHoursForm[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const day of form) {
    const error = dayHoursError(day);
    if (error) errors[day.day] = error;
  }
  return errors;
}

/** Copia el lunes (abierto/cerrado y horas) de martes a viernes. */
export function copyMondayToWeekdays(form: readonly DayHoursForm[]): DayHoursForm[] {
  const monday = form.find(d => d.day === 'Monday');
  if (!monday) return [...form];
  return form.map(d => (WEEKDAYS.has(d.day) ? { ...d, open: monday.open, opens: monday.opens, closes: monday.closes } : d));
}

/** Mismo horario efectivo (los días cerrados no cuentan sus horas). */
export function sameHours(a: readonly DayHoursForm[], b: readonly DayHoursForm[]): boolean {
  return JSON.stringify(toBusinessHours(a)) === JSON.stringify(toBusinessHours(b));
}
