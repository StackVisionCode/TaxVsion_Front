/** Ancho del sidebar expandido cuando todavía no se midió nada (el `w-64` de antes). */
export const SIDEBAR_FALLBACK_WIDTH = 256;
/** Ancho colapsado: solo iconos (`w-16`). */
export const SIDEBAR_COLLAPSED_WIDTH = 64;
/** Límites del ancho expandido: ni tan angosto que el logo no quepa, ni tan ancho que robe pantalla. */
export const SIDEBAR_MIN_WIDTH = 184;
export const SIDEBAR_MAX_WIDTH = 288;

/**
 * Lo que ocupa una fila además del texto: padding del contenedor (`px-2`), padding del botón
 * (`px-4`), icono (`text-lg` ≈ 18px), `gap-3` y una holgura para la barra de scroll y el badge.
 */
const ROW_CHROME = 8 + 8 + 16 + 16 + 18 + 12 + 8;

/**
 * Ancho del sidebar expandido a partir del ancho natural de cada label del menú: se ajusta al
 * nombre más largo en lugar de dejar una franja vacía a la derecha.
 */
export function sidebarExpandedWidth(labelWidths: readonly number[]): number {
  const widest = Math.max(0, ...labelWidths.filter(width => Number.isFinite(width)));
  if (widest <= 0) {
    return SIDEBAR_FALLBACK_WIDTH;
  }
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.ceil(widest + ROW_CHROME)));
}
