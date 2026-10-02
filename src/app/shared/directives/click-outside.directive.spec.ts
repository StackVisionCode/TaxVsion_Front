import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ClickOutsideDirective } from './click-outside.directive';

@Component({
  imports: [ClickOutsideDirective],
  template: `
    <div id="host" appClickOutside [clickOutsideEnabled]="enabled()" (appClickOutside)="count = count + 1">
      <button id="inside">in</button>
    </div>
    <button id="outside">out</button>
  `,
})
class HostComponent {
  readonly enabled = signal(true);
  count = 0;
}

describe('ClickOutsideDirective', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);
    const press = (selector: string) =>
      el.querySelector(selector)!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    return { fixture, el, press };
  }

  it('emite al pulsar fuera y no dentro', () => {
    const { fixture, press, el } = setup();
    press('#inside');
    expect(fixture.componentInstance.count).toBe(0);
    press('#outside');
    expect(fixture.componentInstance.count).toBe(1);
    el.remove();
  });

  it('emite con Escape', () => {
    const { fixture, el } = setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(fixture.componentInstance.count).toBe(1);
    el.remove();
  });

  it('deshabilitado no emite', () => {
    const { fixture, press, el } = setup();
    fixture.componentInstance.enabled.set(false);
    fixture.detectChanges();
    press('#outside');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(fixture.componentInstance.count).toBe(0);
    el.remove();
  });
});
