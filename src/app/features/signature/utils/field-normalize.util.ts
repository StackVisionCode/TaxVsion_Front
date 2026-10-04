/**
 * Conversión de una caja en px de la página renderizada a coordenadas normalizadas [0..1]
 * (origen arriba-izquierda), la convención que exige `FieldPosition` en el backend.
 *
 * Es la ÚNICA implementación: antes estaba copiada en el editor de solicitudes (firmantes y
 * preparador) y en el de plantillas. Al dividir por el tamaño en px de la página renderizada,
 * el resultado no depende del zoom. Reglas (sin cambios respecto de las copias):
 * - cada valor se recorta a [0..1] y se redondea a 4 decimales;
 * - el backend rechaza x+width > 1 o y+height > 1: tras el redondeo se recorta el tamaño;
 * - si la página no existe o mide 0, o la caja queda sin área, devuelve null (no se envía).
 */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageSize {
  width: number;
  height: number;
}

export type NormalizedRect = PixelRect;

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);
const round4 = (value: number): number => Math.round(value * 10000) / 10000;

export function normalizeFieldRect(rect: PixelRect, page: PageSize | null | undefined): NormalizedRect | null {
  if (!page || page.width <= 0 || page.height <= 0) {
    return null;
  }
  const x = round4(clamp01(rect.x / page.width));
  const y = round4(clamp01(rect.y / page.height));
  let width = round4(clamp01(rect.width / page.width));
  let height = round4(clamp01(rect.height / page.height));
  if (x + width > 1) {
    width = round4(1 - x);
  }
  if (y + height > 1) {
    height = round4(1 - y);
  }
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

/** Inversa: de normalizado a px de una página renderizada (para sembrar campos o cambiar de zoom). */
export function denormalizeFieldRect(rect: NormalizedRect, page: PageSize): PixelRect {
  return {
    x: rect.x * page.width,
    y: rect.y * page.height,
    width: rect.width * page.width,
    height: rect.height * page.height,
  };
}
