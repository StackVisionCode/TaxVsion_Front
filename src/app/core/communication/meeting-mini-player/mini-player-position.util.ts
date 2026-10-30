/**
 * Posición del mini-player del meeting (lógica pura, testeable).
 *
 * - `clampMiniPlayerPosition(pos, size, viewport, margin)`: mantiene el panel DENTRO del viewport con
 *   un margen, aunque se arrastre afuera o la ventana se achique. Si el panel es más grande que el
 *   viewport, se pega al margen superior/izquierdo.
 * - `parseStoredPosition(raw)`: lee lo guardado en sessionStorage tolerando basura (null si no sirve).
 * - `avoidReservedCorner(pos, size, viewport, reserved)`: T-58 — si el overlay de llamada ocupa la
 *   esquina inferior derecha (`reserved` = su tamaño), corre el mini-player a la izquierda para no
 *   solaparse; `pos` null = esquina por defecto. Devuelve `pos` sin tocar si no se pisan.
 *
 * Ejemplo:
 *   clampMiniPlayerPosition({ x: 2000, y: -50 }, { width: 360, height: 300 }, { width: 1280, height: 800 })
 *   // → { x: 904, y: 16 }
 */

export interface MiniPlayerPoint {
  x: number;
  y: number;
}

export interface MiniPlayerSize {
  width: number;
  height: number;
}

export const MINI_PLAYER_MARGIN = 16;

export function clampMiniPlayerPosition(
  pos: MiniPlayerPoint,
  size: MiniPlayerSize,
  viewport: MiniPlayerSize,
  margin = MINI_PLAYER_MARGIN,
): MiniPlayerPoint {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  return {
    x: Math.round(Math.min(Math.max(pos.x, margin), maxX)),
    y: Math.round(Math.min(Math.max(pos.y, margin), maxY)),
  };
}

export function avoidReservedCorner(
  pos: MiniPlayerPoint | null,
  size: MiniPlayerSize,
  viewport: MiniPlayerSize,
  reserved: MiniPlayerSize | null,
  margin = MINI_PLAYER_MARGIN,
): MiniPlayerPoint | null {
  if (!reserved) {
    return pos;
  }
  const panel = pos ?? { x: viewport.width - size.width - margin, y: viewport.height - size.height - margin };
  const reservedLeft = viewport.width - margin - reserved.width;
  const reservedTop = viewport.height - margin - reserved.height;
  const overlaps = panel.x + size.width > reservedLeft && panel.y + size.height > reservedTop;
  if (!overlaps) {
    return pos;
  }
  return clampMiniPlayerPosition({ x: reservedLeft - margin - size.width, y: panel.y }, size, viewport, margin);
}

export function parseStoredPosition(raw: string | null): MiniPlayerPoint | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<MiniPlayerPoint>;
    return typeof value?.x === 'number' && typeof value?.y === 'number' && Number.isFinite(value.x) && Number.isFinite(value.y)
      ? { x: value.x, y: value.y }
      : null;
  } catch {
    return null;
  }
}
