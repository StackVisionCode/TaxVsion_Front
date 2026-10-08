import { measureRects, playFlip } from './flip.util';

function rect(left: number, top: number): DOMRect {
  return { left, top, width: 100, height: 100, right: left + 100, bottom: top + 100, x: left, y: top } as DOMRect;
}

/** Elemento con un rect controlable (jsdom no hace layout: todo mide 0). */
function box(left: number, top: number): HTMLElement & { place: (l: number, t: number) => void } {
  const el = document.createElement('div') as unknown as HTMLElement & { place: (l: number, t: number) => void };
  let current = rect(left, top);
  el.getBoundingClientRect = () => current;
  el.place = (l, t) => (current = rect(l, t));
  document.body.appendChild(el);
  return el;
}

describe('flip.util', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('measureRects guarda el rect de cada elemento', () => {
    const a = box(10, 20);
    expect(measureRects([a]).get(a)).toEqual(rect(10, 20));
  });

  it('invierte con translate, anima a 0 y limpia al terminar', () => {
    const a = box(0, 0);
    const before = measureRects([a]);
    a.place(200, 50); // el layout lo movió

    playFlip([a], before, { duration: 100 });
    // Invert: se ve donde estaba
    expect(a.style.translate).toBe('-200px -50px');
    expect(a.style.transition).toBe('none');

    vi.advanceTimersByTime(1); // rAF → Play
    expect(a.style.translate).toBe('');
    expect(a.style.transition).toContain('translate 100ms');

    vi.advanceTimersByTime(200); // respaldo de limpieza
    expect(a.style.transition).toBe('');
    expect(a.style.translate).toBe('');
  });

  it('ignora desplazamientos menores a 1px y elementos sin medida previa', () => {
    const a = box(0, 0);
    const b = box(0, 0);
    const before = measureRects([a]);
    a.place(0.4, 0.4);
    b.place(300, 300);

    playFlip([a, b], before);

    expect(a.style.translate).toBe('');
    expect(b.style.translate).toBe('');
  });

  it('con prefers-reduced-motion no anima', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const a = box(0, 0);
    const before = measureRects([a]);
    a.place(200, 0);

    playFlip([a], before);

    expect(a.style.translate).toBe('');
  });

  it('cancelar limpia en el acto', () => {
    const a = box(0, 0);
    const before = measureRects([a]);
    a.place(120, 0);

    const cancel = playFlip([a], before);
    cancel();

    expect(a.style.translate).toBe('');
    expect(a.style.transition).toBe('');
  });
});
