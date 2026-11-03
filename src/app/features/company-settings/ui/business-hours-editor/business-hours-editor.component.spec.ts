import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DayHoursForm } from '../../data-access/company-settings.model';
import { toHoursForm } from '../../utils/business-hours';
import { BusinessHoursEditorComponent } from './business-hours-editor.component';

/** Editor semanal: errores por día y "Copy Monday to weekdays". */
describe('BusinessHoursEditorComponent', () => {
  function setup(hours: DayHoursForm[]) {
    TestBed.configureTestingModule({ imports: [BusinessHoursEditorComponent] });
    const fixture = TestBed.createComponent(BusinessHoursEditorComponent);
    fixture.componentRef.setInput('hours', hours);
    const changes: DayHoursForm[][] = [];
    fixture.componentInstance.hoursChange.subscribe(h => changes.push(h));
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, changes };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('un día cerrado muestra "Closed" y uno abierto sus horas', () => {
    const { el } = setup(toHoursForm([{ day: 'Monday', opens: '09:00', closes: '18:00' }]));
    const rows = el.querySelectorAll('li');

    expect(rows[0].querySelectorAll('input[type="time"]').length).toBe(2);
    expect(rows[1].textContent).toContain('Closed');
  });

  it('marca el día con cierre anterior a la apertura', () => {
    const { el } = setup(toHoursForm([{ day: 'Monday', opens: '18:00', closes: '09:00' }]));

    expect(el.querySelector('li [role="alert"]')?.textContent).toContain('after opening');
  });

  it('cambiar la hora emite el horario completo', () => {
    const { el, changes } = setup(toHoursForm([{ day: 'Monday', opens: '09:00', closes: '18:00' }]));
    const closes = el.querySelectorAll('li')[0].querySelectorAll('input')[1] as HTMLInputElement;

    closes.value = '17:00';
    closes.dispatchEvent(new Event('input'));

    expect(changes.at(-1)?.[0]).toEqual({ day: 'Monday', open: true, opens: '09:00', closes: '17:00' });
    expect(changes.at(-1)).toHaveLength(7);
  });

  it('"Copy Monday to weekdays" copia el lunes de martes a viernes', () => {
    const { el, changes } = setup(toHoursForm([{ day: 'Monday', opens: '08:00', closes: '16:00' }]));

    (Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('Copy Monday')) as HTMLButtonElement).click();

    const open = changes.at(-1)!.filter(d => d.open).map(d => d.day);
    expect(open).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
  });
});
