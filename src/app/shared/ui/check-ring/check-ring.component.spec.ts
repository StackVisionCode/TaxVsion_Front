import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { CheckRingComponent } from './check-ring.component';

describe('CheckRingComponent', () => {
  function render(ready = true) {
    TestBed.configureTestingModule({ imports: [CheckRingComponent] });
    const fixture = TestBed.createComponent(CheckRingComponent);
    Object.assign(fixture.componentInstance, {
      title: 'Account security',
      status: 'Almost there',
      score: 67,
      tone: 'good',
      ready,
      items: [
        { id: 'email', label: 'Email verified', done: true, target: 'personal' },
        { id: 'phone', label: 'Phone number verified', done: false, target: 'personal' },
      ],
    });
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('pinta el puntaje y solo lo pendiente es un botón', () => {
    const { el } = render();

    expect(el.textContent).toContain('67%');
    expect(el.textContent).toContain('Almost there');
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain('Phone number verified');
  });

  it('el chip pendiente avisa a dónde ir', () => {
    const { fixture, el } = render();
    const targets: string[] = [];
    fixture.componentInstance.fix.subscribe(t => targets.push(t));

    el.querySelector('button')!.click();

    expect(targets).toEqual(['personal']);
  });

  it('sin datos listos muestra esqueleto, no un puntaje falso', () => {
    const { el } = render(false);

    expect(el.textContent).not.toContain('%');
  });
});
