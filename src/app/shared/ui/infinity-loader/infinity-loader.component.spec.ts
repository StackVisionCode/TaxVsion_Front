import { TestBed } from '@angular/core/testing';
import { InfinityLoaderComponent } from './infinity-loader.component';

describe('InfinityLoaderComponent', () => {
  function setup(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(InfinityLoaderComponent);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('se anuncia como estado de carga con su etiqueta', () => {
    const el = setup({ label: 'Saving' });

    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-label')).toBe('Saving');
  });

  it.each([
    ['xs', '18'],
    ['sm', '26'],
    ['md', '44'],
    ['lg', '72'],
  ])('el tamaño %s mide %s px de ancho', (size, width) => {
    const svg = setup({ size }).querySelector('svg')!;

    expect(svg.getAttribute('width')).toBe(width);
    expect(svg.getAttribute('height')).toBe(String(Number(width) / 2));
  });

  it('el tono light se marca para fondos oscuros', () => {
    expect(setup({ tone: 'light' }).querySelector('svg')!.classList.contains('infinity-light')).toBe(true);
    expect(setup().querySelector('svg')!.classList.contains('infinity-light')).toBe(false);
  });
});
