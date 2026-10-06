import { startPointerDrag } from './pointer-drag.util';

/** Target mínimo de eventos (en vez de window) para contar listeners y disparar eventos. */
function fakeTarget() {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    listeners,
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

function pointer(clientX: number, clientY: number, pointerId = 1, currentTarget: unknown = null) {
  return {
    clientX,
    clientY,
    pointerId,
    currentTarget,
    preventDefault: () => undefined,
  } as unknown as PointerEvent;
}

describe('startPointerDrag', () => {
  it('listeners globales SOLO durante el arrastre; se quitan al soltar', () => {
    const target = fakeTarget();
    const onEnd = vi.fn();
    startPointerDrag(pointer(10, 10), {
      getPageRect: () => ({ left: 0, top: 0 }),
      onMove: () => undefined,
      onEnd,
      target,
    });
    expect(target.count()).toBe(4);
    target.fire('pointerup', { pointerId: 1 });
    expect(target.count()).toBe(0);
    expect(onEnd).toHaveBeenCalledWith(false);
  });

  it('pointercancel termina el arrastre como cancelado', () => {
    const target = fakeTarget();
    const onEnd = vi.fn();
    startPointerDrag(pointer(0, 0), {
      getPageRect: () => ({ left: 0, top: 0 }),
      onMove: () => undefined,
      onEnd,
      target,
    });
    target.fire('pointercancel', { pointerId: 1 });
    expect(onEnd).toHaveBeenCalledWith(true);
    expect(target.count()).toBe(0);
  });

  it('emite posición relativa a la página y re-mide el rect si hay scroll', () => {
    const target = fakeTarget();
    const moves: { x: number; y: number; dx: number; dy: number }[] = [];
    let rect = { left: 100, top: 50 };
    startPointerDrag(pointer(110, 60), {
      getPageRect: () => rect,
      onMove: (p) => moves.push(p),
      target,
    });
    target.fire('pointermove', pointer(130, 90));
    expect(moves.at(-1)).toEqual({ x: 30, y: 40, dx: 20, dy: 30 });
    rect = { left: 100, top: 0 }; // el contenedor scrolleó 50px hacia abajo
    target.fire('scroll', {});
    expect(moves.at(-1)).toEqual({ x: 30, y: 90, dx: 20, dy: 30 });
  });

  it('usa setPointerCapture y lo libera al terminar; ignora otros punteros', () => {
    const target = fakeTarget();
    const el = document.createElement('div');
    el.setPointerCapture = vi.fn();
    el.releasePointerCapture = vi.fn();
    const onMove = vi.fn();
    const stop = startPointerDrag(pointer(0, 0, 7, el), {
      getPageRect: () => ({ left: 0, top: 0 }),
      onMove,
      target,
    });
    expect(el.setPointerCapture).toHaveBeenCalledWith(7);
    target.fire('pointermove', pointer(5, 5, 99));
    expect(onMove).not.toHaveBeenCalled();
    stop();
    expect(el.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(target.count()).toBe(0);
  });
});
