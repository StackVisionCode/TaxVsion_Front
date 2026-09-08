import { describe, expect, it } from 'vitest';
import { annotationSupports, fontSizeFor, strokeWidthFor } from './workflow.model';

/**
 * El panel de Propiedades pinta cada sección SOLO si el objeto la usa. Esta tabla es ese
 * contrato: un control de tinta sobre una imagen, o de grosor sobre una nota, no ajustan
 * nada y obligan a probar cuál sirve.
 */
describe('annotationSupports', () => {
  it('la nota tiene papel y opacidad, pero ni tinta ni grosor', () => {
    expect(annotationSupports('note')).toEqual({
      color: true,
      ink: false,
      size: false,
      opacity: true,
      textStyle: false,
    });
  });

  it('la imagen solo admite opacidad: no hay color ni tipografía que ajustar', () => {
    const supports = annotationSupports('image');
    expect(supports.opacity).toBe(true);
    expect(supports.color).toBe(false);
    expect(supports.ink).toBe(false);
    expect(supports.size).toBe(false);
    expect(supports.textStyle).toBe(false);
  });

  it('trazo, flecha y marco comparten tinta y grosor, sin tipografía', () => {
    for (const kind of ['draw', 'arrow', 'rect'] as const) {
      const supports = annotationSupports(kind);
      expect(supports.ink).toBe(true);
      expect(supports.size).toBe(true);
      expect(supports.textStyle).toBe(false);
      expect(supports.color).toBe(false);
    }
  });

  it('el texto es el único con tipografía', () => {
    expect(annotationSupports('text').textStyle).toBe(true);
  });
});

describe('escalas de tamaño', () => {
  it('el grosor crece con el tamaño', () => {
    const widths = (['S', 'M', 'L', 'XL'] as const).map(strokeWidthFor);
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(new Set(widths).size).toBe(4);
  });

  it('el cuerpo de letra crece con el tamaño', () => {
    const sizes = (['S', 'M', 'L', 'XL'] as const).map(fontSizeFor);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(new Set(sizes).size).toBe(4);
  });
});
