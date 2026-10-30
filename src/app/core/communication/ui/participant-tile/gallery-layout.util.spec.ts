import { describe, expect, it } from 'vitest';
import { computeGalleryLayout } from './gallery-layout.util';

const OPTS = { gap: 12, maxTiles: 12 };

describe('computeGalleryLayout (T-57)', () => {
  it('sin medida devuelve una columna sin tamaño (la vista usa el fallback por conteo)', () => {
    expect(computeGalleryLayout(3, 0, 0, OPTS)).toMatchObject({ cols: 1, rows: 3, tileWidth: 0, visible: 3, overflow: 0 });
  });

  it('1 tile 16:9 ocupa lo que permita el lado limitante', () => {
    const wide = computeGalleryLayout(1, 1600, 450, OPTS);
    expect(wide).toMatchObject({ cols: 1, rows: 1, tileWidth: 800, tileHeight: 450 });
    const tall = computeGalleryLayout(1, 640, 1000, OPTS);
    expect(tall).toMatchObject({ cols: 1, rows: 1, tileWidth: 640, tileHeight: 360 });
  });

  it('elige filas × columnas que maximizan el tile: 4 en panorámico → 2×2; 2 en un área estrecha → 1×2', () => {
    expect(computeGalleryLayout(4, 1200, 700, OPTS)).toMatchObject({ cols: 2, rows: 2 });
    const narrow = computeGalleryLayout(2, 360, 800, OPTS);
    expect(narrow.cols).toBe(1);
    expect(narrow.rows).toBe(2);
    expect(narrow.tileWidth).toBe(360);
  });

  it('respeta el gap entre tiles', () => {
    const layout = computeGalleryLayout(2, 1012, 300, OPTS);
    // 2 columnas: (1012 - 12) / 2 = 500 de ancho → 281 de alto (cabe en 300).
    expect(layout).toMatchObject({ cols: 2, rows: 1, tileWidth: 500, tileHeight: 281 });
  });

  it('a partir de maxTiles resume el resto en "+N"', () => {
    const layout = computeGalleryLayout(15, 1600, 900, OPTS);
    expect(layout.visible).toBe(12);
    expect(layout.overflow).toBe(3);
    expect(layout.cols * layout.rows).toBeGreaterThanOrEqual(12);
  });
});
