import { TestBed } from '@angular/core/testing';
import { SignaturePadComponent } from './signature-pad.component';

function fileEvent(file: File): Event {
  const input = document.createElement('input');
  input.type = 'file';
  Object.defineProperty(input, 'files', { value: [file] });
  return { target: input } as unknown as Event;
}

describe('SignaturePadComponent', () => {
  // jsdom no trae ResizeObserver: el pad solo lo usa para dimensionar el canvas.
  beforeAll(() => {
    const g = globalThis as { ResizeObserver?: unknown };
    g.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  });

  function setup(): SignaturePadComponent {
    const fixture = TestBed.createComponent(SignaturePadComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('rechaza formatos que no son PNG/JPEG', () => {
    const pad = setup();
    pad.onFileSelected(fileEvent(new File(['x'], 'sig.gif', { type: 'image/gif' })));
    expect(pad.uploadError()).toContain('PNG or JPEG');
    expect(pad.uploadedDataUrl()).toBeNull();
  });

  it('rechaza imágenes de más de 4 MB', () => {
    const pad = setup();
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'sig.png', { type: 'image/png' });
    pad.onFileSelected(fileEvent(big));
    expect(pad.uploadError()).toContain('4 MB');
  });

  it('la pantalla completa bloquea el scroll de la página y se cierra con Escape', () => {
    const pad = setup();
    pad.expand();
    expect(pad.expanded()).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    pad.onEscape();
    expect(pad.expanded()).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('cambiar la tinta cambia el color expuesto para el texto', () => {
    const pad = setup();
    pad.setInk('blue');
    expect(pad.inkColor()).toBe('#1d4ed8');
  });
});
