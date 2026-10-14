import { computeScale, parseScaleOverride } from './viewport-scale';

describe('viewport scale', () => {
  it.each([
    ['100 %: 1920×940', 1920, 940, 1],
    ['125 %: 1536×750', 1536, 750, 1],
    ['150 %: 1280×620', 1280, 620, 0.86],
    ['175 %: 1097×520', 1097, 520, 0.72],
    ['200 %: 960×470', 960, 470, 0.65],
  ])('%s', (_label, width, height, expected) => {
    expect(computeScale(width, height)).toBe(expected);
  });

  it('nunca amplía ni baja del mínimo', () => {
    expect(computeScale(3840, 2000)).toBe(1);
    expect(computeScale(400, 300)).toBe(0.65);
  });

  it('con medidas inválidas no escala', () => {
    expect(computeScale(0, 700)).toBe(1);
    expect(computeScale(NaN, NaN)).toBe(1);
  });

  it('la preferencia manual solo acepta números razonables', () => {
    expect(parseScaleOverride('0.85')).toBe(0.85);
    expect(parseScaleOverride('auto')).toBeNull();
    expect(parseScaleOverride(null)).toBeNull();
    expect(parseScaleOverride('3')).toBeNull();
    expect(parseScaleOverride('abc')).toBeNull();
  });
});
