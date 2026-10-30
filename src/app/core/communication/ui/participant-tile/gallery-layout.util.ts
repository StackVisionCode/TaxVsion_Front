/**
 * F5 (T-57) — Galería por espacio: dado el área medida y cuántos tiles hay, elige filas × columnas
 * que maximizan el tamaño de cada tile 16:9; a partir de `maxTiles` los demás se resumen en "+N".
 * Pura (sin DOM) para probarla.
 */
export interface GalleryLayout {
  cols: number;
  rows: number;
  /** Tamaño de cada tile en px (0 si el área aún no se midió). */
  tileWidth: number;
  tileHeight: number;
  /** Tiles que se pintan y cuántos quedan fuera ("+N"). */
  visible: number;
  overflow: number;
}

export interface GalleryLayoutOptions {
  /** Separación entre tiles (px). */
  gap: number;
  /** Tope de tiles visibles; el último hueco lo ocupa "+N" si sobran. */
  maxTiles: number;
  aspect?: number;
}

const DEFAULT_ASPECT = 16 / 9;

export function computeGalleryLayout(count: number, width: number, height: number, options: GalleryLayoutOptions): GalleryLayout {
  const aspect = options.aspect ?? DEFAULT_ASPECT;
  const limit = Math.max(1, options.maxTiles);
  const visible = count <= limit ? count : limit;
  const overflow = count - visible;
  const n = Math.max(1, visible);
  if (width <= 0 || height <= 0) {
    return { cols: 1, rows: n, tileWidth: 0, tileHeight: 0, visible, overflow };
  }
  let best: GalleryLayout = { cols: 1, rows: n, tileWidth: 0, tileHeight: 0, visible, overflow };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (width - options.gap * (cols - 1)) / cols;
    const cellH = (height - options.gap * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0) {
      continue;
    }
    // Tile 16:9 dentro de la celda.
    const tileWidth = Math.min(cellW, cellH * aspect);
    const tileHeight = tileWidth / aspect;
    if (tileWidth > best.tileWidth) {
      best = { cols, rows, tileWidth: Math.floor(tileWidth), tileHeight: Math.floor(tileHeight), visible, overflow };
    }
  }
  return best;
}
