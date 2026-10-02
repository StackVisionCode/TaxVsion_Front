import { TestBed } from '@angular/core/testing';
import { SwitchComponent } from './switch.component';

describe('SwitchComponent', () => {
  function create(inputs: { checked?: boolean; disabled?: boolean; busy?: boolean } = {}) {
    TestBed.configureTestingModule({ imports: [SwitchComponent] });
    const fixture = TestBed.createComponent(SwitchComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    const emitted: boolean[] = [];
    fixture.componentInstance.checkedChange.subscribe(value => emitted.push(value));
    return { fixture, button, emitted };
  }

  it('refleja `checked` en aria-checked y en la clase on', () => {
    const { button } = create({ checked: true });
    expect(button.getAttribute('role')).toBe('switch');
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.classList.contains('switch-on')).toBe(true);
  });

  it('al hacer clic emite el valor invertido y mueve el knob sin esperar al padre', () => {
    const { fixture, button, emitted } = create({ checked: false });
    button.click();
    fixture.detectChanges();
    expect(emitted).toEqual([true]);
    expect(button.getAttribute('aria-checked')).toBe('true');
  });

  it('deshabilitado no emite', () => {
    const { button, emitted } = create({ disabled: true });
    expect(button.disabled).toBe(true);
    button.click();
    expect(emitted).toEqual([]);
  });

  it('mientras está busy no acepta clics', () => {
    const { fixture, button, emitted } = create({ busy: true });
    fixture.componentInstance.toggle();
    expect(emitted).toEqual([]);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('si el guardado termina sin cambiar `checked`, vuelve a la posición real', () => {
    const { fixture, button } = create({ checked: false });
    button.click();
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    expect(button.getAttribute('aria-checked')).toBe('true');

    // El servidor falló: el padre apaga busy pero deja checked=false.
    fixture.componentRef.setInput('busy', false);
    fixture.detectChanges();
    expect(button.getAttribute('aria-checked')).toBe('false');
  });

  it('funciona como ControlValueAccessor', () => {
    const { fixture, button } = create();
    const changes: boolean[] = [];
    fixture.componentInstance.registerOnChange(value => changes.push(value));
    fixture.componentInstance.writeValue(true);
    fixture.detectChanges();
    expect(button.getAttribute('aria-checked')).toBe('true');
    button.click();
    expect(changes).toEqual([false]);
  });
});
