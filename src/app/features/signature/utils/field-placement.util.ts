/**
 * Geometría pura para colocar campos en los editores de firma (solicitud y plantilla).
 *
 * Los editores guardan cada campo en px de la página RENDERIZADA (origen arriba-izquierda) y
 * lo normalizan a [0..1] al exportar; aquí solo se resuelve el punto de inserción:
 *  - al SOLTAR desde la paleta (drag & drop): centrado en el puntero y dentro de la página;
 *  - al hacer CLICK (fallback): centrado en la parte visible de la página más visible del
 *    visor, en vez de caer siempre en la página 1.
 */

export interface FieldSize {
  w: number;
  h: number;
}

/** Rectángulo de pantalla (getBoundingClientRect) de una página renderizada. */
export interface PageBox {
  /** 1-based. */
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Rectángulo de pantalla del contenedor con scroll (la ventana visible del documento). */
export interface ViewportBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FieldPlacement {
  page: number;
  x: number;
  y: number;
}

/** MIME propio del drag de la paleta: el drop ignora cualquier otra cosa (archivos, texto…). */
export const FIELD_DRAG_MIME = 'application/x-taxproffice-field';

/** Margen mínimo al borde de la página para el fallback de click. */
const EDGE = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Posición (px relativos a la página) de un campo soltado en (clientX, clientY): el campo queda
 * centrado bajo el puntero y nunca se sale de la página.
 */
export function dropPosition(clientX: number, clientY: number, page: PageBox, size: FieldSize): { x: number; y: number } {
  return {
    x: clamp(clientX - page.left - size.w / 2, 0, page.width - size.w),
    y: clamp(clientY - page.top - size.h / 2, 0, page.height - size.h),
  };
}

/**
 * Fallback de click: elige la página con más área visible dentro del visor y centra el campo en la
 * porción visible de esa página. `null` si ninguna página está a la vista (el caller cae a la 1).
 */
export function visiblePlacement(pages: readonly PageBox[], viewport: ViewportBox, size: FieldSize): FieldPlacement | null {
  const vpRight = viewport.left + viewport.width;
  const vpBottom = viewport.top + viewport.height;
  let best: { page: PageBox; area: number } | null = null;

  for (const page of pages) {
    const visW = Math.min(page.left + page.width, vpRight) - Math.max(page.left, viewport.left);
    const visH = Math.min(page.top + page.height, vpBottom) - Math.max(page.top, viewport.top);
    if (visW <= 0 || visH <= 0) {
      continue;
    }
    const area = visW * visH;
    if (!best || area > best.area) {
      best = { page, area };
    }
  }
  if (!best) {
    return null;
  }

  const p = best.page;
  const visLeft = Math.max(p.left, viewport.left);
  const visRight = Math.min(p.left + p.width, vpRight);
  const visTop = Math.max(p.top, viewport.top);
  const visBottom = Math.min(p.top + p.height, vpBottom);
  const centerX = (visLeft + visRight) / 2 - p.left;
  const centerY = (visTop + visBottom) / 2 - p.top;

  return {
    page: p.page,
    x: clamp(centerX - size.w / 2, EDGE, p.width - size.w - EDGE),
    y: clamp(centerY - size.h / 2, EDGE, p.height - size.h - EDGE),
  };
}

/** Payload serializado en el dataTransfer del drag de la paleta. */
export interface FieldDragPayload<T extends string = string> {
  /** 'signer' = campo del firmante/rol activo; 'preparer' = campo del preparador. */
  kind: 'signer' | 'preparer';
  type: T;
}

export function encodeFieldDrag(payload: FieldDragPayload): string {
  return JSON.stringify(payload);
}

/** Decodifica el payload del drop; `null` si no es nuestro o viene corrupto. */
export function decodeFieldDrag<T extends string>(raw: string | null | undefined, allowed: readonly T[]): FieldDragPayload<T> | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<FieldDragPayload>;
    if ((parsed.kind === 'signer' || parsed.kind === 'preparer') && allowed.includes(parsed.type as T)) {
      return { kind: parsed.kind, type: parsed.type as T };
    }
  } catch {
    // payload ajeno o corrupto: se ignora el drop
  }
  return null;
}
