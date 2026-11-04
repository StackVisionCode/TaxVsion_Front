import { describe, expect, it } from 'vitest';
import {
  copyMondayToWeekdays,
  dayHoursError,
  hoursErrors,
  sameHours,
  toBusinessHours,
  toHoursForm,
} from './business-hours';

/** Editor semanal: un tramo por día como Tenant; cerrado = no viaja. */
describe('business-hours', () => {
  it('arma los 7 días (lunes primero); los que no vienen quedan cerrados', () => {
    const form = toHoursForm([{ day: 'tuesday', opens: '08:30', closes: '12:00' }]);

    expect(form.map(d => d.day)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    expect(form[1]).toEqual({ day: 'Tuesday', open: true, opens: '08:30', closes: '12:00' });
    expect(form[0]).toMatchObject({ open: false, opens: '09:00', closes: '17:00' });
  });

  it('solo viajan los días abiertos', () => {
    const form = toHoursForm([{ day: 'Monday', opens: '09:00', closes: '18:00' }]);

    expect(toBusinessHours(form)).toEqual([{ day: 'Monday', opens: '09:00', closes: '18:00' }]);
  });

  it('el cierre debe ser posterior a la apertura y las horas HH:mm', () => {
    expect(dayHoursError({ day: 'Monday', open: true, opens: '09:00', closes: '09:00' })).toContain('after opening');
    expect(dayHoursError({ day: 'Monday', open: true, opens: '18:00', closes: '09:00' })).toContain('after opening');
    expect(dayHoursError({ day: 'Monday', open: true, opens: '', closes: '17:00' })).toContain('both times');
    expect(dayHoursError({ day: 'Monday', open: false, opens: '18:00', closes: '09:00' })).toBeNull();
    expect(dayHoursError({ day: 'Monday', open: true, opens: '09:00', closes: '17:30' })).toBeNull();
  });

  it('los errores quedan por día', () => {
    const form = toHoursForm([]).map(d => (d.day === 'Friday' ? { ...d, open: true, opens: '17:00', closes: '08:00' } : d));

    expect(Object.keys(hoursErrors(form))).toEqual(['Friday']);
  });

  it('"Copy Monday to weekdays" copia a martes–viernes y no toca el fin de semana', () => {
    const form = toHoursForm([
      { day: 'Monday', opens: '08:00', closes: '16:00' },
      { day: 'Saturday', opens: '10:00', closes: '13:00' },
    ]);

    const copied = copyMondayToWeekdays(form);

    expect(toBusinessHours(copied)).toEqual([
      { day: 'Monday', opens: '08:00', closes: '16:00' },
      { day: 'Tuesday', opens: '08:00', closes: '16:00' },
      { day: 'Wednesday', opens: '08:00', closes: '16:00' },
      { day: 'Thursday', opens: '08:00', closes: '16:00' },
      { day: 'Friday', opens: '08:00', closes: '16:00' },
      { day: 'Saturday', opens: '10:00', closes: '13:00' },
    ]);
  });

  it('cambiar las horas de un día cerrado no cuenta como cambio', () => {
    const form = toHoursForm([]);
    const edited = form.map(d => (d.day === 'Sunday' ? { ...d, opens: '06:00' } : d));

    expect(sameHours(form, edited)).toBe(true);
  });
});
