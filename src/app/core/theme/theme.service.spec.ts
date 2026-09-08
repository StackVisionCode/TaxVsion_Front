import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

/**
 * applyNeutrals tiñe los grises con el hue del primary conservando la luminosidad de cada shade. Este
 * test verifica que, para primaries diversos, el contraste de los pares críticos texto/fondo se
 * mantiene sobre el umbral WCAG — la garantía de que teñir los neutros nunca vuelve la UI ilegible.
 */

// Relative luminance (WCAG 2.x).
function luminance([r, g, b]: readonly [number, number, number]): number {
  const chan = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function contrast(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function grayVar(shade: number): [number, number, number] {
  const raw = document.documentElement.style.getPropertyValue(`--color-gray-${shade}-rgb`).trim();
  const [r, g, b] = raw.split(/\s+/).map(Number);
  return [r, g, b];
}

const WHITE: [number, number, number] = [255, 255, 255];
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

// Azul de marca, rojo, verde, ámbar, violeta, y un gris de baja saturación (caso borde).
const PRIMARIES = ['#1e466b', '#e11d48', '#059669', '#d97706', '#7c3aed', '#334155'];

describe('ThemeService.applyNeutrals — contraste preservado', () => {
  let service: ThemeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ThemeService);
    SHADES.forEach((s) => document.documentElement.style.removeProperty(`--color-gray-${s}-rgb`));
  });

  PRIMARIES.forEach((primary) => {
    it(`mantiene el contraste con primary ${primary}`, () => {
      service.applyNeutrals(primary);

      // Texto principal (gray-900) sobre fondo claro (gray-50): AA holgado.
      expect(contrast(grayVar(900), grayVar(50))).toBeGreaterThanOrEqual(4.5);
      // Texto de cuerpo (gray-700) sobre fondo de página (gray-50): AA.
      expect(contrast(grayVar(700), grayVar(50))).toBeGreaterThanOrEqual(4.5);
      // Texto secundario (gray-500) sobre blanco: AA para texto grande / UI.
      expect(contrast(grayVar(500), WHITE)).toBeGreaterThanOrEqual(3.0);
    });
  });

  it('un hex inválido no escribe variables (no rompe el look)', () => {
    service.applyNeutrals('not-a-hex');
    expect(document.documentElement.style.getPropertyValue('--color-gray-500-rgb')).toBe('');
  });
});
