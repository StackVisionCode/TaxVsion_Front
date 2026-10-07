import { prefersReducedMotion } from './reduced-motion.util';

/**
 * FLIP (First, Last, Invert, Play): anima cambios de LAYOUT (reordenar, cambiar de columna) como
 * si fueran movimientos, usando solo `translate` → corre en el compositor, a 60 fps.
 *
 * Uso:
 * ```ts
 * const before = measureRects(cells);   // First: posiciones antes del cambio
 * moverCosasEnElDom();                  // el cambio de layout (sort, re-render…)
 * playFlip(cells, before);              // Last + Invert + Play
 * ```
 *
 * Detalles:
 * - Usa la propiedad independiente `translate` (no `transform`): así convive con keyframes que
 *   animan `transform` con fill-mode `both` (que pisarían un transform en línea) y con el
 *   `transform` que el CDK escribe en sus elementos.
 * - Al terminar SIEMPRE limpia el estilo (regla R8: un translate/transform aplicado convierte al
 *   elemento en containing block de sus hijos `position: fixed`).
 * - Ignora desplazamientos < 1px y elementos que no estaban en `before`.
 * - Con `prefers-reduced-motion: reduce` no anima (el layout cambia igual, de golpe).
 * - Devuelve una función para cancelar (limpia en el acto).
 */

export interface FlipOptions {
  /** Duración en ms (default 260). */
  duration?: number;
  /** Curva CSS (default cubic-bezier(0.2, 0, 0, 1)). */
  easing?: string;
}

const DEFAULT_DURATION = 260;
const DEFAULT_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
/** Margen extra del timeout de respaldo por si `transitionend` no llega (pestaña oculta, etc.). */
const CLEANUP_GRACE_MS = 80;

/** Limpieza pendiente de cada elemento que está animando (una animación nueva cancela la vieja). */
const pendingCleanup = new WeakMap<HTMLElement, () => void>();

export function measureRects(elements: Iterable<HTMLElement>): Map<HTMLElement, DOMRect> {
  const rects = new Map<HTMLElement, DOMRect>();
  for (const el of elements) {
    rects.set(el, el.getBoundingClientRect());
  }
  return rects;
}

export function playFlip(
  elements: Iterable<HTMLElement>,
  before: Map<HTMLElement, DOMRect>,
  options: FlipOptions = {},
): () => void {
  if (prefersReducedMotion()) {
    return () => undefined;
  }
  const duration = options.duration ?? DEFAULT_DURATION;
  const easing = options.easing ?? DEFAULT_EASING;

  // Last + Invert: cada elemento vuelve a verse donde estaba, sin transición.
  const moved: HTMLElement[] = [];
  for (const el of elements) {
    const first = before.get(el);
    if (!first) {
      continue;
    }
    // Si venía de otra animación FLIP a medias, arranca desde donde se VE ahora (su posición de
    // layout anterior + el tramo de translate que le quedaba), no desde su hueco: sin saltos.
    const [inFlightX, inFlightY] = el.style.translate ? currentTranslate(el) : [0, 0];
    pendingCleanup.get(el)?.();
    el.style.transition = 'none';
    el.style.translate = '';
    const last = el.getBoundingClientRect();
    const dx = first.left + inFlightX - last.left;
    const dy = first.top + inFlightY - last.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      el.style.transition = '';
      continue;
    }
    el.style.translate = `${dx}px ${dy}px`;
    moved.push(el);
  }
  if (moved.length === 0) {
    return () => undefined;
  }

  // Forzar el reflow para que el navegador "vea" el punto de partida antes de animar.
  void moved[0].offsetWidth;

  const cleanups: (() => void)[] = [];
  const frame = requestAnimationFrame(() => {
    // Play: de la posición vieja a la nueva.
    for (const el of moved) {
      el.style.transition = `translate ${duration}ms ${easing}`;
      el.style.translate = '';
      const clear = () => {
        el.style.transition = '';
        el.style.translate = '';
        el.removeEventListener('transitionend', onEnd);
        clearTimeout(timer);
        if (pendingCleanup.get(el) === clear) {
          pendingCleanup.delete(el);
        }
      };
      const onEnd = (event: TransitionEvent) => {
        if (event.target === el && event.propertyName === 'translate') {
          clear();
        }
      };
      const timer = setTimeout(clear, duration + CLEANUP_GRACE_MS);
      el.addEventListener('transitionend', onEnd);
      pendingCleanup.set(el, clear);
      cleanups.push(clear);
    }
  });

  return () => {
    cancelAnimationFrame(frame);
    cleanups.forEach(clear => clear());
    for (const el of moved) {
      el.style.transition = '';
      el.style.translate = '';
    }
  };
}

/** Translate interpolado que tiene ahora el elemento (en mitad de una transición), en px. */
function currentTranslate(el: HTMLElement): [number, number] {
  const value = getComputedStyle(el).translate;
  if (!value || value === 'none') {
    return [0, 0];
  }
  const [x = '0', y = '0'] = value.split(/\s+/);
  const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : 0);
  return [px(x), px(y)];
}
