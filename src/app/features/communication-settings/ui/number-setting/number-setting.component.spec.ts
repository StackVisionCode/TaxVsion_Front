import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { CommNumberSettingComponent } from './number-setting.component';

/** F9 — número acotado por el techo del plan: nunca deja guardar más que el límite y explica por qué. */
describe('CommNumberSettingComponent', () => {
  function render(inputs: Partial<CommNumberSettingComponent>) {
    const fixture = TestBed.createComponent(CommNumberSettingComponent);
    Object.assign(fixture.componentInstance, { label: 'Default meeting length', min: 5, max: 60, unit: 'min', ...inputs });
    const emitted: (number | null)[] = [];
    fixture.componentInstance.valueChange.subscribe(value => emitted.push(value));
    fixture.detectChanges();
    return { fixture, emitted, el: fixture.nativeElement as HTMLElement };
  }

  it('90 con techo 60 se ajusta a 60 y avisa del límite del plan', () => {
    const { fixture, emitted, el } = render({ value: 45, limitLabel: "your plan's limit" });
    const input = el.querySelector('[data-role="number-input"]') as HTMLInputElement;
    input.value = '90';
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(emitted).toEqual([60]);
    expect(input.value).toBe('60');
    expect(el.querySelector('[data-role="number-adjusted"]')?.textContent).toContain("Set to 60, the most allowed (your plan's limit).");
  });

  it('con "Use default" el valor vuelve a null y se muestra el heredado', () => {
    const { fixture, emitted, el } = render({ value: 30, nullable: true, inherited: 60 });
    const toggle = el.querySelector('[data-role="use-default"]') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(emitted).toEqual([null]);
    expect(el.textContent).toContain('Use default (60 min)');
  });
});
