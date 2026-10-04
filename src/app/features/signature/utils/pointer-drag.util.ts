/**
 * Sesión de arrastre con puntero (ratón, lápiz o dedo) para mover/redimensionar cajas sobre una
 * página. Sustituye a los `@HostListener('document:pointermove'/'pointerup')` permanentes:
 *
 * - los listeners globales existen SOLO mientras dura el arrastre (se quitan al soltar/cancelar);
 * - `setPointerCapture` sobre el elemento que inició el gesto: el arrastre no se "pega" si el
 *   puntero sale de la ventana o pasa sobre un iframe;
 * - `pointercancel` (el navegador roba el gesto táctil para hacer scroll/zoom) termina el arrastre;
 * - si el contenedor hace scroll durante el arrastre, el rect de la página se vuelve a medir, así
 *   la caja sigue al puntero en vez de desplazarse con el scroll.
 *
 * Uso:
 *   this.stopDrag = startPointerDrag(event, {
 *     getPageRect: () => pageEl.getBoundingClientRect(),
 *     onMove: ({ x, y, dx, dy }) => ...,   // x/y: puntero relativo a la página; dx/dy: desde el inicio
 *     onEnd: cancelled => ...,
 *   });
 *
 * Devuelve una función para cortar el arrastre desde fuera (p. ej. al empezar un re-render).
 */
export interface PointerDragPoint {
  /** Puntero relativo a la esquina superior izquierda de la página (px). */
  x: number;
  y: number;
  /** Desplazamiento del puntero desde el inicio del arrastre (px de pantalla). */
  dx: number;
  dy: number;
}

export interface PointerDragOptions {
  getPageRect: () => { left: number; top: number };
  onMove: (point: PointerDragPoint) => void;
  onEnd?: (cancelled: boolean) => void;
  /** Para tests: dónde se cuelgan los listeners (default `window`). */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

export function startPointerDrag(event: PointerEvent, options: PointerDragOptions): () => void {
  const target = options.target ?? window;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  let lastX = startX;
  let lastY = startY;
  let rect = options.getPageRect();
  let active = true;

  const captureEl = event.currentTarget instanceof Element ? event.currentTarget : null;
  try {
    captureEl?.setPointerCapture?.(pointerId);
  } catch {
    // Algunos navegadores lanzan si el puntero ya no está activo: el arrastre sigue con los listeners.
  }

  const emit = (): void => {
    options.onMove({
      x: lastX - rect.left,
      y: lastY - rect.top,
      dx: lastX - startX,
      dy: lastY - startY,
    });
  };

  const onMove = (e: Event): void => {
    const pe = e as PointerEvent;
    if (pe.pointerId !== undefined && pe.pointerId !== pointerId) {
      return;
    }
    pe.preventDefault?.();
    lastX = pe.clientX;
    lastY = pe.clientY;
    emit();
  };
  const onScroll = (): void => {
    rect = options.getPageRect();
    emit();
  };
  const finish = (cancelled: boolean): void => {
    if (!active) {
      return;
    }
    active = false;
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onCancel);
    target.removeEventListener('scroll', onScroll, true);
    try {
      captureEl?.releasePointerCapture?.(pointerId);
    } catch {
      // no-op
    }
    options.onEnd?.(cancelled);
  };
  const onUp = (e: Event): void => {
    const pe = e as PointerEvent;
    if (pe.pointerId === undefined || pe.pointerId === pointerId) {
      finish(false);
    }
  };
  const onCancel = (e: Event): void => {
    const pe = e as PointerEvent;
    if (pe.pointerId === undefined || pe.pointerId === pointerId) {
      finish(true);
    }
  };

  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onCancel);
  // capture: true para enterarse del scroll de cualquier contenedor (el área del documento scrollea por dentro).
  target.addEventListener('scroll', onScroll, true);

  return () => finish(true);
}
