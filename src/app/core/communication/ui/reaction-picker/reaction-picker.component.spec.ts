import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ReactionPickerComponent } from './reaction-picker.component';

@Component({
  imports: [ReactionPickerComponent],
  template: `
    <div class="relative">
      @if (open()) {
        <app-reaction-picker [catalog]="catalog" (picked)="picks.push($event)" (closed)="open.set(false)" />
      }
    </div>
  `,
})
class HostComponent {
  readonly catalog = ['👍', '👏', '❤️'];
  readonly open = signal(true);
  picks: string[] = [];
}

function setup() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, host: fixture.componentInstance, el, chips: () => [...el.querySelectorAll<HTMLButtonElement>('button')] };
}

describe('ReactionPickerComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('pinta el catálogo de la política como chips accesibles dentro de un dialog', () => {
    const { el, chips } = setup();
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Pick a reaction');
    expect(chips().map(c => c.textContent?.trim())).toEqual(['👍', '👏', '❤️']);
    expect(chips()[1].getAttribute('aria-label')).toBe('React with 👏');
  });

  it('al elegir emite la reacción y se cierra', () => {
    const { fixture, host, chips } = setup();
    chips()[2].click();
    fixture.detectChanges();
    expect(host.picks).toEqual(['❤️']);
    expect(host.open()).toBe(false);
  });

  it('teclado: flechas mueven el foco en círculo, Escape cierra', () => {
    const { fixture, host, el, chips } = setup();
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    chips()[0].focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(chips()[1]);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(chips()[2]);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(host.open()).toBe(false);
  });
});
