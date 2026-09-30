/**
 * Cálculo de la grilla de video del meeting a partir del tamaño REAL del contenedor (medido con
 * ResizeObserver). Todo en px CSS del contenedor, así la grilla se re-acomoda sola con el zoom del
 * navegador, la rotación del móvil o al abrir un panel lateral — sin alturas fijas.
 */

export interface GridLayout {
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

/**
 * Elige el número de columnas que MAXIMIZA el área de cada tile (todas iguales, relación `aspect`)
 * dentro de `width × height`, con `gap` entre tiles. Es el algoritmo típico de Meet/Zoom.
 */
export function computeGridLayout(width: number, height: number, count: number, gap = 12, aspect = 16 / 9): GridLayout {
  if (count <= 0 || width <= 0 || height <= 0) {
    return { cols: 1, rows: 1, tileWidth: Math.max(0, Math.floor(width)), tileHeight: Math.max(0, Math.floor(height)) };
  }
  let best: GridLayout | null = null;
  let bestArea = -1;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const availW = (width - gap * (cols - 1)) / cols;
    const availH = (height - gap * (rows - 1)) / rows;
    if (availW <= 0 || availH <= 0) {
      continue;
    }
    const tileWidth = Math.min(availW, availH * aspect);
    const tileHeight = tileWidth / aspect;
    const area = tileWidth * tileHeight;
    // Empate (±0.5px²): preferir menos columnas → tiles más anchos en una fila menos.
    if (area > bestArea + 0.5) {
      bestArea = area;
      best = { cols, rows, tileWidth: Math.floor(tileWidth), tileHeight: Math.floor(tileHeight) };
    }
  }
  return best ?? { cols: 1, rows: count, tileWidth: 0, tileHeight: 0 };
}

/**
 * Cuántos tiles caben como máximo sin que ninguno quede más angosto que `minTileWidth`. Siempre al
 * menos 1 y como mucho `hardCap` (más tiles = más decodificación de video; el resto va a "+N").
 */
export function maxTilesFor(width: number, height: number, minTileWidth: number, gap = 12, aspect = 16 / 9, hardCap = 16): number {
  let fit = 1;
  for (let n = 1; n <= hardCap; n++) {
    if (computeGridLayout(width, height, n, gap, aspect).tileWidth >= minTileWidth) {
      fit = n;
    } else {
      break;
    }
  }
  return fit;
}

/** Datos mínimos de un tile para decidir el orden / qué se ve. */
export interface TileCandidate {
  id: string;
  isLocal: boolean;
  pinned: boolean;
  handRaised: boolean;
  speaking: boolean;
  joinOrder: number;
}

export interface VisibleTiles {
  /** ids a pintar, en orden. */
  visible: string[];
  /** Cuántos quedan fuera (se muestran como un tile "+N"); 0 si entran todos. */
  overflow: number;
}

/**
 * Qué tiles se pintan cuando hay más participantes que lugar. Si entran todos, orden ESTABLE (fijado,
 * yo, orden de llegada) para que la grilla no salte. Si no entran, se priorizan los que importan:
 * fijado > yo > mano levantada > hablando > orden de llegada, y el último lugar lo ocupa el "+N".
 */
export function selectVisibleTiles(candidates: TileCandidate[], maxTiles: number): VisibleTiles {
  const max = Math.max(1, Math.floor(maxTiles));
  const stable = [...candidates].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.isLocal) - Number(a.isLocal) || a.joinOrder - b.joinOrder,
  );
  if (stable.length <= max) {
    return { visible: stable.map(c => c.id), overflow: 0 };
  }
  const prioritized = [...candidates].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      Number(b.isLocal) - Number(a.isLocal) ||
      Number(b.handRaised) - Number(a.handRaised) ||
      Number(b.speaking) - Number(a.speaking) ||
      a.joinOrder - b.joinOrder,
  );
  const slots = Math.max(1, max - 1); // un lugar para el "+N"
  return { visible: prioritized.slice(0, slots).map(c => c.id), overflow: candidates.length - slots };
}
