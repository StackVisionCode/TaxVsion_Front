import { describe, expect, it } from 'vitest';
import { StampFieldKind, stampFontSizeForBox } from './stamp-font-size.util';

/**
 * F6 — Las fórmulas aquí deben coincidir CON LA DEL BACKEND (PdfSharpSealingEngine.cs). Si el
 * sealing engine cambia, estos vectores deben actualizarse en el mismo PR o el preview mentirá.
 *
 * Vectores calculados a mano reproduciendo las fórmulas del backend:
 *  - signatureBand(h) = max(1, h - captionBand - metaBand - gap)
 *      captionBand = h>=34 ? min(10, h*0.20) : 0
 *      metaBand    = min(11, h*0.24)
 *      gap         = min(2, h*0.04)
 *  - signature: clamp(signatureBand * 0.72, 9, 24)   (sin FitFontSize posterior — fallback tipográfico)
 *  - initials : clamp(h * 0.55 * 0.8, 6, 20)         (starting size de FitFontSize; cap bajo)
 *  - text/date: clamp(h * 0.8, 6, 18)                (starting size; may shrink por ancho)
 */
describe('stampFontSizeForBox (F6)', () => {
  describe('signature (fallback tipográfico)', () => {
    const cases: Array<[number, number]> = [
      // h  → pt esperado
      [20, 10], // caja chica → captionBand=0, metaBand=4.8, gap=0.8 → band=14.4 → 14.4*0.72=10.4 → round 10
      [40, 15], // caja media → captionBand=8, metaBand=9.6, gap=1.6 → band=20.8 → 14.98 → round 15
      [80, 24], // caja grande → captionBand=10, metaBand=11, gap=2 → band=57 → 41.04 → clamp a 24
    ];
    it.each(cases)('h=%d → %dpt', (h, expected) => {
      const r = stampFontSizeForBox('signature', h);
      expect(r.mayShrink).toBe(false);
      expect(r.pt).toBe(expected);
    });
  });

  describe('initials', () => {
    const cases: Array<[number, number]> = [
      [10, 6], // 10*0.55*0.8 = 4.4 → clamp a 6
      [30, 13], // 30*0.44 = 13.2 → round 13
      [80, 20], // 80*0.44 = 35.2 → clamp a 20
    ];
    it.each(cases)('h=%d → %dpt', (h, expected) => {
      const r = stampFontSizeForBox('initials', h);
      expect(r.mayShrink).toBe(false);
      expect(r.pt).toBe(expected);
    });
  });

  describe('text and date', () => {
    const cases: Array<[StampFieldKind, number, number]> = [
      ['text', 6, 6], // 6*0.8 = 4.8 → clamp a 6
      ['text', 15, 12], // 15*0.8 = 12
      ['date', 30, 18], // 30*0.8 = 24 → clamp a 18
      ['text', 80, 18],
    ];
    it.each(cases)('%s h=%d → %dpt', (kind, h, expected) => {
      const r = stampFontSizeForBox(kind, h);
      expect(r.mayShrink).toBe(true);
      expect(r.pt).toBe(expected);
    });
  });

  it('zero or negative height falls back to the minimum', () => {
    expect(stampFontSizeForBox('signature', 0).pt).toBe(9);
    expect(stampFontSizeForBox('initials', -5).pt).toBe(6);
    expect(stampFontSizeForBox('text', 0).pt).toBe(6);
  });

  it('cap values stay bounded as height grows', () => {
    expect(stampFontSizeForBox('signature', 10000).pt).toBe(24);
    expect(stampFontSizeForBox('initials', 10000).pt).toBe(20);
    expect(stampFontSizeForBox('text', 10000).pt).toBe(18);
  });
});
