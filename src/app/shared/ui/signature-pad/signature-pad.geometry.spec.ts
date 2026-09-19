import {
  IDENTITY_TRANSFORM,
  fitFontSize,
  fitTransform,
  scaleToMax,
  strokesBounds,
  toModel,
} from './signature-pad.geometry';

describe('signature-pad geometry', () => {
  it('strokesBounds envuelve todos los puntos (null sin trazos)', () => {
    expect(strokesBounds([])).toBeNull();
    expect(
      strokesBounds([
        [{ x: 10, y: 20 }, { x: 50, y: 5 }],
        [{ x: 30, y: 80 }],
      ]),
    ).toEqual({ minX: 10, minY: 5, maxX: 50, maxY: 80 });
  });

  it('fitTransform deja la firma donde está si cabe', () => {
    expect(fitTransform({ minX: 10, minY: 10, maxX: 200, maxY: 100 }, 300, 160)).toEqual(IDENTITY_TRANSFORM);
  });

  it('fitTransform encoge y centra una firma que ya no cabe (p. ej. tras salir de pantalla completa)', () => {
    const t = fitTransform({ minX: 0, minY: 0, maxX: 600, maxY: 300 }, 300, 160, 10);
    expect(t.scale).toBeCloseTo(Math.min(280 / 600, 140 / 300));
    const left = 0 * t.scale + t.offsetX;
    const right = 600 * t.scale + t.offsetX;
    expect(left).toBeCloseTo(300 - right); // centrada horizontalmente
    expect(right).toBeLessThanOrEqual(300);
  });

  it('toModel invierte la transformación', () => {
    const t = { scale: 0.5, offsetX: 20, offsetY: 10 };
    const model = { x: 100, y: 40 };
    const screen = { x: model.x * t.scale + t.offsetX, y: model.y * t.scale + t.offsetY };
    expect(toModel(screen, t)).toEqual(model);
  });

  it('fitFontSize achica la fuente hasta que el texto cabe, sin bajar del mínimo', () => {
    const measure = (size: number) => size * 10; // 10 px por punto de fuente
    expect(fitFontSize(measure, 448, 56, 22)).toBe(44);
    expect(fitFontSize(measure, 100, 56, 22)).toBe(22);
    expect(fitFontSize(measure, 1000, 56, 22)).toBe(56);
  });

  it('scaleToMax reduce el lado mayor y nunca agranda', () => {
    expect(scaleToMax(4000, 3000, 800)).toEqual({ width: 800, height: 600 });
    expect(scaleToMax(400, 200, 800)).toEqual({ width: 400, height: 200 });
  });
});
