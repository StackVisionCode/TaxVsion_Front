import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { LaunchOverlayComponent } from './launch-overlay.component';

describe('LaunchOverlayComponent', () => {
  function render(inputs: Partial<LaunchOverlayComponent>) {
    TestBed.configureTestingModule({ imports: [LaunchOverlayComponent] });
    const fixture = TestBed.createComponent(LaunchOverlayComponent);
    Object.entries(inputs).forEach(([key, value]) => fixture.componentRef.setInput(key, value));
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('en idle no pinta nada', () => {
    const { el } = render({ phase: 'idle' });

    expect(el.querySelector('[role="status"]')).toBeNull();
  });

  it('en working muestra el caption de trabajo y todavía sin sello', () => {
    const { el } = render({ phase: 'working', workingCaption: 'Sending to Ana…', doneCaption: 'Sent to Ana' });

    expect(el.textContent).toContain('Sending to Ana…');
    expect(el.querySelector('.launch-stamp')).toBeNull();
  });

  it('en done muestra el caption final y el sello', () => {
    const { el } = render({ phase: 'done', workingCaption: 'Sending…', doneCaption: 'Sent to Ana' });

    expect(el.textContent).toContain('Sent to Ana');
    expect(el.querySelector('.launch-stamp')).not.toBeNull();
  });

  it('publish lleva el sello de versión y el barrido de validación', () => {
    const { el } = render({ phase: 'working', variant: 'publish', badge: 'v2' });

    expect(el.textContent).toContain('v2 · Live');
    expect(el.querySelector('.sheet-scan')).not.toBeNull();
  });

  it('exit="hold" deja la pantalla cubierta al terminar en vez de desvanecerse', () => {
    const { el } = render({ phase: 'done', exit: 'hold' });
    const overlay = el.querySelector('[role="status"]')!;

    expect(overlay.classList).toContain('launch-hold');
    expect(overlay.classList).not.toContain('launch-out');
  });
});
