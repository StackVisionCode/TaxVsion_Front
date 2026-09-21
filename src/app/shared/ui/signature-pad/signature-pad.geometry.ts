/**
 * Geometría pura del pad de firma (sin DOM), separada para poder probarla.
 *
 * Los trazos se guardan en píxeles CSS del espacio en que se dibujaron ("modelo"). Al
 * cambiar el tamaño del canvas (rotar el teléfono, abrir la pantalla completa) no se
 * pierden: se redibujan con una transformación que solo ENCOGE y centra si ya no caben.
 */

export interface PadPoint {
  x: number;
  y: number;
}

export type PadStroke = PadPoint[];

export interface PadBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Transformación modelo → pantalla: `screen = model * scale + offset`. */
export interface PadTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export const IDENTITY_TRANSFORM: PadTransform = { scale: 1, offsetX: 0, offsetY: 0 };

/** Caja que envuelve todos los puntos; null si no hay trazos. */
export function strokesBounds(strokes: readonly PadStroke[]): PadBounds | null {
  let bounds: PadBounds | null = null;
  for (const stroke of strokes) {
    for (const { x, y } of stroke) {
      if (!bounds) {
        bounds = { minX: x, minY: y, maxX: x, maxY: y };
      } else {
        bounds.minX = Math.min(bounds.minX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxX = Math.max(bounds.maxX, x);
        bounds.maxY = Math.max(bounds.maxY, y);
      }
    }
  }
  return bounds;
}

/**
 * Si la firma cabe en el canvas tal cual, se deja donde está (identidad). Si no, se
 * encoge uniformemente (sin deformar) y se centra, con un margen.
 */
export function fitTransform(bounds: PadBounds | null, width: number, height: number, padding = 12): PadTransform {
  if (!bounds || width <= 0 || height <= 0) {
    return IDENTITY_TRANSFORM;
  }
  const fits = bounds.minX >= 0 && bounds.minY >= 0 && bounds.maxX <= width && bounds.maxY <= height;
  if (fits) {
    return IDENTITY_TRANSFORM;
  }
  const contentW = Math.max(bounds.maxX - bounds.minX, 1);
  const contentH = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min(1, (width - padding * 2) / contentW, (height - padding * 2) / contentH);
  return {
    scale,
    offsetX: (width - contentW * scale) / 2 - bounds.minX * scale,
    offsetY: (height - contentH * scale) / 2 - bounds.minY * scale,
  };
}

/** Inversa de la transformación: un toque en pantalla → coordenadas del modelo. */
export function toModel(point: PadPoint, t: PadTransform): PadPoint {
  return { x: (point.x - t.offsetX) / t.scale, y: (point.y - t.offsetY) / t.scale };
}

/**
 * Mayor tamaño de fuente (entre `min` y `start`) cuyo texto mide como mucho `maxWidth`.
 * `measure(size)` devuelve el ancho del texto a ese tamaño.
 */
export function fitFontSize(measure: (size: number) => number, maxWidth: number, start: number, min: number): number {
  let size = start;
  while (size > min && measure(size) > maxWidth) {
    size -= 2;
  }
  return Math.max(size, min);
}

/** Dimensiones escaladas para que el lado mayor no pase de `maxSide` (nunca agranda). */
export function scaleToMax(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide || longest === 0) {
    return { width, height };
  }
  const ratio = maxSide / longest;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}
