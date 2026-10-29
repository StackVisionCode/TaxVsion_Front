import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { computeTooltipPosition, TooltipDirective } from './tooltip.directive';

@Component({
  imports: [TooltipDirective],
  template: `
    <button id="pin" type="button" aria-describedby="other" [appTooltip]="label()" [appTooltipDisabled]="off()">Pin</button>
    <button id="empty" type="button" appTooltip="">Empty</button>
  `,
})
class HostComponent {
  readonly label = signal('Pin note');
  readonly off = signal(false);
}

const tooltip = (): HTMLElement | null => document.querySelector('[role="tooltip"]');

describe('TooltipDirective', () => {
  function setup() {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    const pin = fixture.nativeElement.querySelector('#pin') as HTMLButtonElement;
    return { fixture, pin };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    document.querySelectorAll('[role="tooltip"]').forEach(el => el.remove());
  });

  it('aparece tras el retardo al pasar el ratón, portado al body y enlazado con aria-describedby', () => {
    const { pin } = setup();
    pin.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    expect(tooltip()).toBeNull();

    vi.advanceTimersByTime(150);
    const tip = tooltip();
    expect(tip?.textContent).toBe('Pin note');
    expect(tip?.parentElement).toBe(document.body);
    expect(pin.getAttribute('aria-describedby')).toBe(`other ${tip?.id}`);

    pin.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tooltip()).toBeNull();
    expect(pin.getAttribute('aria-describedby')).toBe('other');
  });

  it('salir antes del retardo cancela la apertura', () => {
    const { pin } = setup();
    pin.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(100);
    pin.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(500);
    expect(tooltip()).toBeNull();
  });

  it('se muestra con el foco de teclado y se cierra con Escape', () => {
    const { pin } = setup();
    // jsdom no modela :focus-visible: se fuerza el foco "de teclado".
    vi.spyOn(pin, 'matches').mockReturnValue(true);
    pin.dispatchEvent(new FocusEvent('focusin'));
    vi.advanceTimersByTime(300);
    expect(tooltip()).toBeTruthy();

    pin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tooltip()).toBeNull();
  });

  it('actualiza el texto con el tooltip abierto y no abre si está vacío o deshabilitado', () => {
    const { fixture, pin } = setup();
    pin.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(300);
    fixture.componentInstance.label.set('Unpin note');
    fixture.detectChanges();
    expect(tooltip()?.textContent).toBe('Unpin note');

    fixture.componentInstance.off.set(true);
    fixture.detectChanges();
    expect(tooltip()).toBeNull();
    pin.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(400);
    expect(tooltip()).toBeNull();

    const empty = fixture.nativeElement.querySelector('#empty') as HTMLButtonElement;
    empty.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(400);
    expect(tooltip()).toBeNull();
  });

  it('se quita del body al destruir el anfitrión', () => {
    const { fixture, pin } = setup();
    pin.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(300);
    expect(tooltip()).toBeTruthy();
    fixture.destroy();
    expect(tooltip()).toBeNull();
  });
});

describe('computeTooltipPosition', () => {
  const viewport = { width: 1000, height: 800 };
  const tip = { width: 100, height: 24 };

  it('arriba y centrado cuando cabe', () => {
    const pos = computeTooltipPosition({ top: 200, bottom: 232, left: 400, width: 32 }, tip, viewport);
    expect(pos).toEqual({ top: 200 - 6 - 24, left: 416 - 50, placement: 'top' });
  });

  it('hace flip abajo si arriba no cabe y se mantiene dentro de la ventana', () => {
    const pos = computeTooltipPosition({ top: 10, bottom: 42, left: 0, width: 32 }, tip, viewport);
    expect(pos.placement).toBe('bottom');
    expect(pos.top).toBe(42 + 6);
    expect(pos.left).toBe(8);
  });

  it('respeta bottom y hace flip arriba al pie de la ventana', () => {
    const pos = computeTooltipPosition({ top: 770, bottom: 795, left: 980, width: 20 }, tip, viewport, 'bottom');
    expect(pos.placement).toBe('top');
    expect(pos.left).toBe(1000 - 100 - 8);
  });
});
