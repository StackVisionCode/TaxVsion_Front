import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FullscreenFrameDirective } from './fullscreen-frame.directive';

@Component({
  imports: [FullscreenFrameDirective],
  template: `
    <div appFullscreenFrame #fs="fullscreenFrame" data-role="stage">
      <video></video>
      <input type="range" data-role="volume" />
      <span data-role="state">{{ fs.active() ? 'on' : 'off' }}|{{ fs.idle() ? 'idle' : 'awake' }}|{{ fs.supported }}</span>
    </div>
  `,
})
class HostComponent {}

/** jsdom no implementa la Fullscreen API: se simula el documento y el elemento. */
function fakeFullscreen() {
  let current: Element | null = null;
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => current });
  const exit = vi.fn(async () => {
    current = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  const request = vi.fn(async function (this: Element) {
    current = this;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request });
  return { request, exit };
}

function setup() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const stage = el.querySelector('[data-role="stage"]') as HTMLElement;
  const state = () => {
    fixture.detectChanges();
    return el.querySelector('[data-role="state"]')?.textContent?.trim();
  };
  return { fixture, stage, state, el };
}

describe('FullscreenFrameDirective', () => {
  let api: ReturnType<typeof fakeFullscreen>;
  beforeEach(() => {
    api = fakeFullscreen();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('pone en pantalla completa el contenedor (no el video) con doble clic y sale con otro', async () => {
    const { stage, state } = setup();
    expect(state()).toBe('off|awake|true');

    stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await vi.waitFor(() => expect(api.request).toHaveBeenCalled());
    expect(api.request.mock.contexts[0]).toBe(stage);
    expect(state()).toBe('on|awake|true');
    expect(stage.hasAttribute('data-fullscreen')).toBe(true);

    stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await vi.waitFor(() => expect(api.exit).toHaveBeenCalled());
    expect(state()).toBe('off|awake|true');
  });

  it('el doble clic sobre un control (volumen) no alterna', () => {
    const { el } = setup();
    el.querySelector('[data-role="volume"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(api.request).not.toHaveBeenCalled();
  });

  it('en pantalla completa oculta controles tras unos segundos quieto y los muestra al mover el puntero', async () => {
    const { stage, state } = setup();
    stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await vi.waitFor(() => expect(state()).toBe('on|awake|true'));

    vi.advanceTimersByTime(2600);
    expect(state()).toBe('on|idle|true');
    expect(stage.classList).toContain('cursor-none');

    stage.dispatchEvent(new Event('pointermove'));
    expect(state()).toBe('on|awake|true');
  });

  it('si la vista se va con pantalla completa activa (dejó de compartir), sale', async () => {
    const { stage, fixture } = setup();
    stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await vi.waitFor(() => expect(api.request).toHaveBeenCalled());
    fixture.destroy();
    expect(api.exit).toHaveBeenCalled();
  });
});
