/**
 * Arrastre desde la PALETA de campos (Signature, Initials, Date, Text…) hasta una página del
 * documento, con "fantasma" que sigue al puntero. Lo usan el editor de solicitudes y el de plantillas.
 *
 * Por qué no HTML5 drag-and-drop (`draggable`): la imagen de arrastre es estática y fea (no se puede
 * animar ni inclinar), no hay touch en móviles y no deja hacer auto-scroll fino. Se hace como
 * Documenso/dnd-kit: Pointer Events + pointer capture + fantasma con `translate3d` en rAF.
 *
 * Reglas del gesto (`startPaletteDrag`):
 * - ratón: el arrastre empieza al moverse más de MOUSE_DRAG_THRESHOLD_PX; un clic sin mover sigue
 *   siendo un clic normal (armar "clic en la página" / colocar en la página visible);
 * - táctil/lápiz: pulsación larga de LONG_PRESS_MS; si el dedo se mueve antes (> TOUCH_SLOP_PX) se
 *   aborta y el navegador hace scroll normal. Ya arrastrando, `touchmove` se cancela (sin scroll);
 * - Escape o `pointercancel` cancelan; soltar llama a `onDrop` con el último punto;
 * - tras un arrastre real se traga el `click` que el navegador dispara al soltar sobre el botón;
 * - auto-scroll del contenedor cerca de sus bordes (velocidad proporcional a la cercanía);
 * - los listeners globales existen SOLO durante el gesto y se quitan al terminar.
 *
 * Uso:
 *   this.stopPaletteDrag = startPaletteDrag(event, {
 *     getScrollContainer: () => this.surfaceEl,
 *     onArming: armed => ...,        // táctil: feedback mientras se mantiene pulsado
 *     onStart: p => ...,             // mostrar fantasma
 *     onFrame: p => ...,             // en rAF: mover fantasma, resaltar página, vista previa
 *     onDrop: p => ...,              // crear el campo (o animar la vuelta si cayó fuera)
 *     onCancel: () => ...,           // Escape / pointercancel: animar la vuelta
 *   });
 *
 * Funciones puras (con spec): `exceedsThreshold`, `usesLongPress`, `hitTestPages`,
 * `centeredRect`, `dropRectOnPage`, `autoScrollSpeed`.
 */

/** Movimiento mínimo (px) para que un clic con ratón pase a ser arrastre. */
export const MOUSE_DRAG_THRESHOLD_PX = 4;
/** Pulsación larga (ms) que inicia el arrastre con dedo o lápiz. */
export const LONG_PRESS_MS = 250;
/** Tolerancia (px) de movimiento del dedo antes de que venza la pulsación larga (más = scroll). */
export const TOUCH_SLOP_PX = 8;
/** Franja (px) junto al borde superior/inferior del contenedor que activa el auto-scroll. */
export const AUTO_SCROLL_EDGE_PX = 56;
/** Velocidad máxima de auto-scroll (px por frame) con el puntero pegado o fuera del borde. */
export const AUTO_SCROLL_MAX_SPEED = 18;
/** Duración de las animaciones de asentado / vuelta a la paleta (ms). */
export const SETTLE_MS = 180;
export const RETURN_MS = 220;

export interface ClientPoint {
  clientX: number;
  clientY: number;
}

export interface PageRect {
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PageHit {
  page: number;
  /** Punto relativo a la esquina superior izquierda de la página (px). */
  x: number;
  y: number;
}

export interface RectPx {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------

/** true si el desplazamiento supera el umbral (distancia euclídea). */
export function exceedsThreshold(dx: number, dy: number, threshold: number): boolean {
  return dx * dx + dy * dy > threshold * threshold;
}

/** Dedo y lápiz arrancan con pulsación larga (para no robarle el scroll); el ratón con umbral. */
export function usesLongPress(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen';
}

/** Página bajo el punto (bordes incluidos) y el punto relativo a ella; null si no hay ninguna. */
export function hitTestPages(point: ClientPoint, pages: readonly PageRect[]): PageHit | null {
  for (const rect of pages) {
    const x = point.clientX - rect.left;
    const y = point.clientY - rect.top;
    if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
      return { page: rect.page, x, y };
    }
  }
  return null;
}

/** Caja centrada en el punto (la misma regla que "clic en la página": el campo se centra). */
export function centeredRect(point: { x: number; y: number }, size: { w: number; h: number }): RectPx {
  return { x: point.x - size.w / 2, y: point.y - size.h / 2, width: size.w, height: size.h };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Dónde cae el campo al soltar: centrado en el punto y metido dentro de la página. Misma salida
 * que `clampToPage` de editor-fields.util (lo comprueba el spec), así la vista previa y el campo
 * creado coinciden al píxel.
 */
export function dropRectOnPage(
  point: { x: number; y: number },
  size: { w: number; h: number },
  page: { width: number; height: number },
): RectPx {
  const raw = centeredRect(point, size);
  const width = Math.min(raw.width, page.width);
  const height = Math.min(raw.height, page.height);
  return {
    width,
    height,
    x: clamp(raw.x, 0, page.width - width),
    y: clamp(raw.y, 0, page.height - height),
  };
}

/**
 * Velocidad de auto-scroll vertical (px/frame): negativa cerca del borde superior, positiva cerca
 * del inferior, 0 en el centro. Crece linealmente al acercarse al borde y se satura fuera de él.
 */
export function autoScrollSpeed(
  clientY: number,
  container: { top: number; bottom: number },
  edge = AUTO_SCROLL_EDGE_PX,
  maxSpeed = AUTO_SCROLL_MAX_SPEED,
): number {
  const height = container.bottom - container.top;
  if (height <= 0 || edge <= 0) {
    return 0;
  }
  // En contenedores bajos la franja no puede pasar de un tercio del alto (si no, siempre scrollea).
  const band = Math.min(edge, height / 3);
  const fromTop = clientY - container.top;
  const fromBottom = container.bottom - clientY;
  if (fromTop < band) {
    return -Math.round(maxSpeed * Math.min(1, (band - fromTop) / band));
  }
  if (fromBottom < band) {
    return Math.round(maxSpeed * Math.min(1, (band - fromBottom) / band));
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Sesión del gesto (DOM)
// ---------------------------------------------------------------------------

type ListenerTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export interface PaletteDragOptions {
  /** Contenedor con scroll del documento (auto-scroll); null = sin auto-scroll. */
  getScrollContainer?: () => HTMLElement | null;
  /** Táctil: true al empezar a mantener pulsado, false al abortar o al iniciar el arrastre. */
  onArming?: (armed: boolean) => void;
  onStart: (point: ClientPoint) => void;
  /** Una vez por frame mientras se arrastra (movimiento o auto-scroll). */
  onFrame: (point: ClientPoint) => void;
  onDrop: (point: ClientPoint) => void;
  onCancel: () => void;
  /** Para tests: dónde se cuelgan los listeners (default `window`). */
  target?: ListenerTarget;
  raf?: (cb: () => void) => number;
  cancelRaf?: (id: number) => void;
}

/**
 * Empieza a escuchar un gesto sobre un botón de la paleta. No hace nada visible hasta superar el
 * umbral (ratón) o la pulsación larga (táctil). Devuelve una función para cortarlo desde fuera
 * (destroy, re-render): si el arrastre estaba activo, llama a `onCancel`.
 */
export function startPaletteDrag(event: PointerEvent, options: PaletteDragOptions): () => void {
  const target: ListenerTarget = options.target ?? window;
  const raf =
    options.raf ??
    ((cb: () => void) =>
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number));
  const cancelRaf =
    options.cancelRaf ??
    ((id: number) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id)));

  const pointerId = event.pointerId;
  const longPress = usesLongPress(event.pointerType);
  const startX = event.clientX;
  const startY = event.clientY;
  const captureEl = event.currentTarget instanceof Element ? event.currentTarget : null;
  let last: ClientPoint = { clientX: startX, clientY: startY };
  let phase: 'pending' | 'dragging' | 'done' = 'pending';
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let frame: number | null = null;

  const startDragging = (): void => {
    phase = 'dragging';
    if (longPress) {
      options.onArming?.(false);
    }
    try {
      captureEl?.setPointerCapture?.(pointerId);
    } catch {
      // El puntero ya no está activo: los listeners de window bastan.
    }
    // Tras un arrastre el navegador dispara `click` sobre el botón: se traga (no debe armar nada).
    target.addEventListener('click', swallowClick, true);
    options.onStart(last);
    options.onFrame(last);
    loop();
  };

  const loop = (): void => {
    frame = raf(() => {
      frame = null;
      if (phase !== 'dragging') {
        return;
      }
      const container = options.getScrollContainer?.() ?? null;
      if (container) {
        const rect = container.getBoundingClientRect();
        const speed = autoScrollSpeed(last.clientY, rect);
        if (speed !== 0) {
          container.scrollTop += speed;
        }
      }
      options.onFrame(last);
      loop();
    });
  };

  const samePointer = (e: Event): boolean => {
    const id = (e as PointerEvent).pointerId;
    return id === undefined || id === pointerId;
  };

  const onMove = (e: Event): void => {
    if (!samePointer(e)) {
      return;
    }
    const pe = e as PointerEvent;
    last = { clientX: pe.clientX, clientY: pe.clientY };
    const dx = pe.clientX - startX;
    const dy = pe.clientY - startY;
    if (phase === 'pending') {
      if (longPress) {
        // El dedo se movió antes de la pulsación larga: es un scroll, no un arrastre.
        if (exceedsThreshold(dx, dy, TOUCH_SLOP_PX)) {
          finish('abort');
        }
        return;
      }
      if (exceedsThreshold(dx, dy, MOUSE_DRAG_THRESHOLD_PX)) {
        pe.preventDefault?.();
        startDragging();
      }
      return;
    }
    if (phase === 'dragging') {
      pe.preventDefault?.();
    }
  };

  const onUp = (e: Event): void => {
    if (!samePointer(e)) {
      return;
    }
    const pe = e as PointerEvent;
    if (phase === 'dragging') {
      last = { clientX: pe.clientX ?? last.clientX, clientY: pe.clientY ?? last.clientY };
      finish('drop');
    } else {
      finish('abort');
    }
  };

  const onPointerCancel = (e: Event): void => {
    if (samePointer(e)) {
      finish(phase === 'dragging' ? 'cancel' : 'abort');
    }
  };

  const onKeydown = (e: Event): void => {
    const ke = e as KeyboardEvent;
    if (ke.key !== 'Escape') {
      return;
    }
    if (phase === 'dragging') {
      // Que el Escape no cierre además el wizard / el panel.
      ke.preventDefault?.();
      ke.stopImmediatePropagation?.();
      finish('cancel');
    } else {
      finish('abort');
    }
  };

  // Ya arrastrando con el dedo, el navegador no debe hacer scroll (si lo hiciera mandaría pointercancel).
  const onTouchMove = (e: Event): void => {
    if (phase === 'dragging' && e.cancelable) {
      e.preventDefault();
    }
  };

  // Pulsación larga: sin menú contextual / lupa del sistema mientras se mantiene o se arrastra.
  const onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  function swallowClick(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    target.removeEventListener('click', swallowClick, true);
  }

  const finish = (result: 'drop' | 'cancel' | 'abort'): void => {
    if (phase === 'done') {
      return;
    }
    const wasDragging = phase === 'dragging';
    phase = 'done';
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    if (frame !== null) {
      cancelRaf(frame);
      frame = null;
    }
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onPointerCancel);
    target.removeEventListener('keydown', onKeydown, true);
    target.removeEventListener('touchmove', onTouchMove);
    target.removeEventListener('contextmenu', onContextMenu, true);
    try {
      captureEl?.releasePointerCapture?.(pointerId);
    } catch {
      // no-op
    }
    if (wasDragging) {
      // El click (si llega) se dispara en esta misma tarea, justo después de pointerup.
      setTimeout(() => target.removeEventListener('click', swallowClick, true), 0);
    } else if (longPress) {
      options.onArming?.(false);
    }
    if (result === 'drop') {
      options.onDrop(last);
    } else if (result === 'cancel' && wasDragging) {
      options.onCancel();
    }
  };

  target.addEventListener('pointermove', onMove, { passive: false });
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onPointerCancel);
  target.addEventListener('keydown', onKeydown, true);
  if (longPress) {
    // passive: false para poder cancelar el scroll una vez que arranca el arrastre.
    target.addEventListener('touchmove', onTouchMove, { passive: false });
    target.addEventListener('contextmenu', onContextMenu, true);
    options.onArming?.(true);
    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (phase === 'pending') {
        startDragging();
      }
    }, LONG_PRESS_MS);
  }

  return () => finish('cancel');
}

/** Rects de las páginas renderizadas dentro de un contenedor (elementos con `data-page`). */
export function measurePages(container: ParentNode | null | undefined): PageRect[] {
  if (!container) {
    return [];
  }
  return Array.from(container.querySelectorAll<HTMLElement>('[data-page]')).map(el => {
    const r = el.getBoundingClientRect();
    return { page: Number(el.dataset['page']) || 0, left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

// ---------------------------------------------------------------------------
// Fantasma (DOM): solo transform/opacity, nada de layout por frame
// ---------------------------------------------------------------------------

/** Coloca el fantasma (position: fixed; left/top 0) con su esquina superior izquierda en left/top. */
export function setGhostPosition(el: HTMLElement | null | undefined, left: number, top: number): void {
  if (el) {
    el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }
}

/**
 * Anima el fantasma hasta un destino (asentarse sobre el campo creado o volver a la paleta) y
 * llama a `done` al terminar. Con `ms = 0` (movimiento reducido) es inmediato.
 */
export function animateGhostTo(
  el: HTMLElement | null | undefined,
  to: { left: number; top: number; scale?: number; opacity?: number },
  ms: number,
  done: () => void,
): ReturnType<typeof setTimeout> | null {
  if (!el || ms <= 0) {
    done();
    return null;
  }
  el.style.transition = `transform ${ms}ms cubic-bezier(0.2, 0, 0, 1), opacity ${ms}ms ease`;
  el.style.transform = `translate3d(${to.left}px, ${to.top}px, 0) scale(${to.scale ?? 1})`;
  el.style.opacity = String(to.opacity ?? 0);
  return setTimeout(done, ms);
}

/** Deja el fantasma listo para el próximo arrastre (sin transición ni opacidad residual). */
export function resetGhost(el: HTMLElement | null | undefined): void {
  if (el) {
    el.style.transition = '';
    el.style.opacity = '';
  }
}
