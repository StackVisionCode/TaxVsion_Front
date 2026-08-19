import { screenRectToPdf } from './signature-coords.util';

describe('screenRectToPdf', () => {
  it('convierte px de pantalla a puntos PDF con el eje Y invertido y escala', () => {
    // Página carta (792pt) renderizada a escala 1.2 → 950.4px de alto.
    const metrics = { scale: 1.2, height: 950.4 };
    const rect = screenRectToPdf({ page: 1, x: 120, y: 240, width: 180, height: 60 }, metrics);

    expect(rect.page).toBe(1);
    expect(rect.posX).toBeCloseTo(100, 1); // 120 / 1.2
    expect(rect.width).toBeCloseTo(150, 1); // 180 / 1.2
    expect(rect.height).toBeCloseTo(50, 1); // 60 / 1.2
    expect(rect.posY).toBeCloseTo((950.4 - 240 - 60) / 1.2, 1); // ≈ 542
  });

  it('un campo pegado al borde superior queda arriba (Y alta) en coords PDF', () => {
    const rect = screenRectToPdf({ page: 2, x: 0, y: 0, width: 100, height: 40 }, { scale: 1, height: 792 });
    expect(rect.posY).toBeCloseTo(752, 1); // 792 - 0 - 40
  });

  it('scale 0 no rompe (usa 1 por defecto)', () => {
    const rect = screenRectToPdf({ page: 1, x: 10, y: 10, width: 20, height: 20 }, { scale: 0, height: 100 });
    expect(rect.posX).toBe(10);
    expect(rect.posY).toBe(70); // 100 - 10 - 20
  });
});
