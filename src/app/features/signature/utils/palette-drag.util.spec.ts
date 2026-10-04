import {
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_MAX_SPEED,
  LONG_PRESS_MS,
  autoScrollSpeed,
  dropRectOnPage,
  exceedsThreshold,
  hitTestPages,
  startPaletteDrag,
  usesLongPress,
} from './palette-drag.util';
import { clampToPage, scaleSize } from './editor-fields.util';
import { normalizeFieldRect } from './field-normalize.util';
import { PlacedField } from '../ui/signature-request-panel/signature-wizard.model';

/** Target mínimo de eventos (en vez de window) para contar listeners y disparar eventos. */
function fakeTarget() {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener: (type: string, fn: EventListener) => {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: EventListener) => listeners.get(type)?.delete(fn),
    fire(type: string, event: object) {
      for (const fn of [...(listeners.get(type) ?? [])]) {
        fn(event as Event);
      }
    },
    count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}

function pointer(clientX: number, clientY: number, pointerType = 'mouse', pointerId = 1) {
  return {
    clientX,
    clientY,
    pointerId,
    pointerType,
    button: 0,
    currentTarget: null,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent;
}

function session(down: PointerEvent) {
  const target = fakeTarget();
  const handlers = {
    onArming: vi.fn(),
    onStart: vi.fn(),
    onFrame: vi.fn(),
    onDrop: vi.fn(),
    onCancel: vi.fn(),
  };
  // rAF manual: los tests no dependen de frames reales.
  const frames: (() => void)[] = [];
  const stop = startPaletteDrag(down, {
    ...handlers,
    target: target as unknown as Window,
    raf: cb => frames.push(cb),
    cancelRaf: () => undefined,
  });
  return { target, stop, frames, ...handlers };
}

describe('palette-drag.util — funciones puras', () => {
  it('umbral de movimiento (ratón: 4px)', () => {
    expect(exceedsThreshold(3, 0, 4)).toBe(false);
    expect(exceedsThreshold(4, 0, 4)).toBe(false);
    expect(exceedsThreshold(3, 3, 4)).toBe(true);
    expect(exceedsThreshold(0, -5, 4)).toBe(true);
  });

  it('dedo y lápiz usan pulsación larga; el ratón no', () => {
    expect(usesLongPress('touch')).toBe(true);
    expect(usesLongPress('pen')).toBe(true);
    expect(usesLongPress('mouse')).toBe(false);
  });

  it('hit-testing: página bajo el punto y punto relativo; fuera de toda página → null', () => {
    const pages = [
      { page: 1, left: 100, top: 50, width: 400, height: 500 },
      { page: 2, left: 100, top: 566, width: 400, height: 500 },
    ];
    expect(hitTestPages({ clientX: 150, clientY: 70 }, pages)).toEqual({ page: 1, x: 50, y: 20 });
    expect(hitTestPages({ clientX: 500, clientY: 600 }, pages)).toEqual({ page: 2, x: 400, y: 34 });
    expect(hitTestPages({ clientX: 99, clientY: 70 }, pages)).toBeNull();
    // Hueco entre páginas.
    expect(hitTestPages({ clientX: 200, clientY: 560 }, pages)).toBeNull();
  });

  it('el campo se centra en el punto y se mete en la página (igual que clampToPage del click)', () => {
    const page = { page: 1, width: 600, height: 800 };
    const size = { w: 200, h: 60 };
    for (const point of [
      { x: 300, y: 400 },
      { x: 5, y: 5 },
      { x: 599, y: 799 },
      { x: 120, y: 790 },
    ]) {
      const rect = dropRectOnPage(point, size, page);
      const viaClick = clampToPage<PlacedField>(
        { id: 'f', type: 'signature', page: 1, signerId: 's', x: point.x - 100, y: point.y - 30, width: 200, height: 60 },
        page,
      );
      expect(rect).toEqual({ x: viaClick.x, y: viaClick.y, width: viaClick.width, height: viaClick.height });
    }
    expect(dropRectOnPage({ x: 5, y: 5 }, size, page)).toEqual({ x: 0, y: 0, width: 200, height: 60 });
    expect(dropRectOnPage({ x: 599, y: 799 }, size, page)).toEqual({ x: 400, y: 740, width: 200, height: 60 });
  });

  it('a zoom 0.6 / 1 / 2 el mismo punto relativo da la MISMA caja normalizada', () => {
    const base = { w: 612 * 1.2, h: 792 * 1.2 };
    const results = [0.6, 1, 2].map(zoom => {
      const page = { width: base.w * zoom, height: base.h * zoom };
      const point = { x: 0.3 * page.width, y: 0.55 * page.height };
      return normalizeFieldRect(dropRectOnPage(point, scaleSize({ w: 200, h: 60 }, zoom), page), page);
    });
    expect(results[0]).toEqual(results[1]);
    expect(results[2]).toEqual(results[1]);
  });

  it('auto-scroll: 0 en el centro, proporcional cerca de los bordes y saturado fuera', () => {
    const box = { top: 100, bottom: 700 };
    expect(autoScrollSpeed(400, box)).toBe(0);
    expect(autoScrollSpeed(100, box)).toBe(-AUTO_SCROLL_MAX_SPEED);
    expect(autoScrollSpeed(40, box)).toBe(-AUTO_SCROLL_MAX_SPEED);
    expect(autoScrollSpeed(100 + AUTO_SCROLL_EDGE_PX / 2, box)).toBe(-Math.round(AUTO_SCROLL_MAX_SPEED / 2));
    expect(autoScrollSpeed(700 - AUTO_SCROLL_EDGE_PX / 2, box)).toBe(Math.round(AUTO_SCROLL_MAX_SPEED / 2));
    expect(autoScrollSpeed(760, box)).toBe(AUTO_SCROLL_MAX_SPEED);
    expect(autoScrollSpeed(100 + AUTO_SCROLL_EDGE_PX + 1, box)).toBe(0);
    // Contenedor bajo (90px): la franja se limita a un tercio, el centro no scrollea.
    expect(autoScrollSpeed(145, { top: 100, bottom: 190 })).toBe(0);
    expect(autoScrollSpeed(10, { top: 0, bottom: 0 })).toBe(0);
  });
});

describe('startPaletteDrag', () => {
  afterEach(() => vi.useRealTimers());

  it('ratón: un clic sin moverse no arrastra y suelta los listeners', () => {
    const s = session(pointer(10, 10));
    s.target.fire('pointermove', pointer(12, 11));
    s.target.fire('pointerup', pointer(12, 11));
    expect(s.onStart).not.toHaveBeenCalled();
    expect(s.onDrop).not.toHaveBeenCalled();
    expect(s.target.count()).toBe(0);
  });

  it('ratón: pasado el umbral arranca, cada frame informa el punto y al soltar cae en el último', () => {
    vi.useFakeTimers();
    const s = session(pointer(10, 10));
    s.target.fire('pointermove', pointer(20, 10));
    expect(s.onStart).toHaveBeenCalledWith({ clientX: 20, clientY: 10 });
    s.target.fire('pointermove', pointer(80, 90));
    s.frames.shift()!();
    expect(s.onFrame).toHaveBeenLastCalledWith({ clientX: 80, clientY: 90 });
    s.target.fire('pointerup', pointer(81, 92));
    expect(s.onDrop).toHaveBeenCalledWith({ clientX: 81, clientY: 92 });
    expect(s.onCancel).not.toHaveBeenCalled();
    // El click que sigue a pointerup se traga; luego no queda ningún listener.
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    s.target.fire('click', click);
    expect(click.stopPropagation).toHaveBeenCalled();
    vi.runAllTimers();
    expect(s.target.count()).toBe(0);
  });

  it('táctil: moverse antes de la pulsación larga es scroll (no arrastra)', () => {
    vi.useFakeTimers();
    const s = session(pointer(10, 10, 'touch'));
    expect(s.onArming).toHaveBeenCalledWith(true);
    s.target.fire('pointermove', pointer(10, 30, 'touch'));
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(s.onStart).not.toHaveBeenCalled();
    expect(s.onArming).toHaveBeenLastCalledWith(false);
    expect(s.target.count()).toBe(0);
  });

  it('táctil: mantener 250 ms levanta el campo; ya arrastrando se cancela el scroll del navegador', () => {
    vi.useFakeTimers();
    const s = session(pointer(10, 10, 'touch'));
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(s.onStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(s.onStart).toHaveBeenCalledTimes(1);
    const touchmove = { cancelable: true, preventDefault: vi.fn() };
    s.target.fire('touchmove', touchmove);
    expect(touchmove.preventDefault).toHaveBeenCalled();
    s.target.fire('pointermove', pointer(200, 300, 'touch'));
    s.target.fire('pointerup', pointer(200, 300, 'touch'));
    expect(s.onDrop).toHaveBeenCalledWith({ clientX: 200, clientY: 300 });
  });

  it('Escape cancela (sin crear nada) y no deja que el Escape cierre el wizard', () => {
    const s = session(pointer(0, 0));
    s.target.fire('pointermove', pointer(30, 30));
    const esc = { key: 'Escape', preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    s.target.fire('keydown', esc);
    expect(esc.stopImmediatePropagation).toHaveBeenCalled();
    expect(s.onCancel).toHaveBeenCalledTimes(1);
    s.target.fire('pointerup', pointer(30, 30));
    expect(s.onDrop).not.toHaveBeenCalled();
  });

  it('pointercancel durante el arrastre cancela; cortar desde fuera sin arrastre no avisa', () => {
    const a = session(pointer(0, 0));
    a.target.fire('pointermove', pointer(30, 30));
    a.target.fire('pointercancel', pointer(30, 30));
    expect(a.onCancel).toHaveBeenCalledTimes(1);

    const b = session(pointer(0, 0));
    b.stop();
    expect(b.onCancel).not.toHaveBeenCalled();
    expect(b.target.count()).toBe(0);
  });

  it('ignora otros punteros (multitáctil)', () => {
    const s = session(pointer(0, 0));
    s.target.fire('pointermove', pointer(50, 50, 'mouse', 2));
    expect(s.onStart).not.toHaveBeenCalled();
  });
});
