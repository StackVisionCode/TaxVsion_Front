import { denormalizeFieldRect, normalizeFieldRect } from './field-normalize.util';

describe('normalizeFieldRect', () => {
  const page = { width: 612, height: 792 };

  it('divide por el tamaño de la página y redondea a 4 decimales', () => {
    expect(normalizeFieldRect({ x: 100, y: 200, width: 150, height: 40 }, page)).toEqual({
      x: 0.1634,
      y: 0.2525,
      width: 0.2451,
      height: 0.0505,
    });
  });

  it('el resultado no depende del zoom (misma caja relativa a 0.6, 1 y 2)', () => {
    const base = { x: 100, y: 200, width: 150, height: 40 };
    const at = (zoom: number) =>
      normalizeFieldRect(
        { x: base.x * zoom, y: base.y * zoom, width: base.width * zoom, height: base.height * zoom },
        { width: page.width * zoom, height: page.height * zoom },
      );
    expect(at(0.6)).toEqual(at(1));
    expect(at(2)).toEqual(at(1));
  });

  it('ida y vuelta: normalizar y desnormalizar a otro zoom conserva la posición relativa', () => {
    const norm = normalizeFieldRect({ x: 306, y: 396, width: 122.4, height: 39.6 }, page)!;
    const back = denormalizeFieldRect(norm, { width: page.width * 2, height: page.height * 2 });
    expect(back.x).toBeCloseTo(612, 0);
    expect(back.y).toBeCloseTo(792, 0);
    expect(back.width).toBeCloseTo(244.8, 0);
  });

  it('recorta a [0..1] y nunca deja x+width > 1', () => {
    const r = normalizeFieldRect({ x: 600, y: -10, width: 100, height: 40 }, page)!;
    expect(r.y).toBe(0);
    expect(r.x + r.width).toBeLessThanOrEqual(1);
  });

  it('devuelve null sin página, con página de tamaño 0 o caja sin área', () => {
    expect(normalizeFieldRect({ x: 1, y: 1, width: 10, height: 10 }, null)).toBeNull();
    expect(normalizeFieldRect({ x: 1, y: 1, width: 10, height: 10 }, { width: 0, height: 792 })).toBeNull();
    expect(normalizeFieldRect({ x: 612, y: 10, width: 50, height: 10 }, page)).toBeNull();
  });
});
