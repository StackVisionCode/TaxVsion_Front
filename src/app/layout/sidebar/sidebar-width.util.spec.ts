import {
  SIDEBAR_FALLBACK_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  sidebarExpandedWidth,
} from './sidebar-width.util';

describe('sidebarExpandedWidth', () => {
  it('se ajusta al label más ancho más el espacio fijo de la fila', () => {
    // 124px de "Products/Services" + 86px de padding, icono y gap.
    expect(sidebarExpandedWidth([60, 124, 90])).toBe(210);
  });

  it('no baja del mínimo con un menú de nombres cortos', () => {
    expect(sidebarExpandedWidth([20, 30])).toBe(SIDEBAR_MIN_WIDTH);
  });

  it('no pasa del máximo con un nombre muy largo', () => {
    expect(sidebarExpandedWidth([600])).toBe(SIDEBAR_MAX_WIDTH);
  });

  it('sin medidas devuelve el ancho de siempre', () => {
    expect(sidebarExpandedWidth([])).toBe(SIDEBAR_FALLBACK_WIDTH);
    expect(sidebarExpandedWidth([0, NaN])).toBe(SIDEBAR_FALLBACK_WIDTH);
  });

  it('redondea hacia arriba para que el texto no se corte por un decimal', () => {
    expect(sidebarExpandedWidth([124.2])).toBe(211);
  });
});
