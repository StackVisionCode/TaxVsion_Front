import {
  MAX_ZOOM,
  MIN_ZOOM,
  ViewerHttpError,
  clampIndex,
  detectViewerKind,
  friendlyViewerError,
  kindLabel,
  moveIndex,
  parseCsv,
  parsePageInput,
  stepZoom,
} from './file-viewer.model';

describe('file-viewer.model', () => {
  describe('detectViewerKind', () => {
    it('el MIME manda cuando es concreto', () => {
      expect(detectViewerKind('archivo.bin', 'application/pdf')).toBe('pdf');
      expect(detectViewerKind('foto', 'image/png')).toBe('image');
      expect(detectViewerKind('x', 'text/csv; charset=utf-8')).toBe('csv');
      expect(detectViewerKind('x', 'text/plain')).toBe('text');
      expect(detectViewerKind('x', 'application/json')).toBe('text');
    });

    it('con MIME genérico o ausente decide la extensión', () => {
      expect(detectViewerKind('W2.PDF', 'application/octet-stream')).toBe('pdf');
      expect(detectViewerKind('scan.jpeg', null)).toBe('image');
      expect(detectViewerKind('datos.csv')).toBe('csv');
      expect(detectViewerKind('notas.txt', '')).toBe('text');
    });

    it('imágenes que el navegador no pinta y tipos desconocidos → unsupported', () => {
      expect(detectViewerKind('scan.tiff', 'image/tiff')).toBe('unsupported');
      expect(detectViewerKind('foto.heic', 'image/heic')).toBe('unsupported');
      expect(detectViewerKind('libro.xlsx')).toBe('unsupported');
      expect(detectViewerKind('sin-extension')).toBe('unsupported');
    });
  });

  it('kindLabel usa la extensión para los no soportados', () => {
    expect(kindLabel('pdf')).toBe('PDF');
    expect(kindLabel('unsupported', 'libro.xlsx')).toBe('XLSX');
    expect(kindLabel('unsupported', 'sin-extension')).toBe('File');
  });

  describe('parseCsv', () => {
    it('respeta comillas, comillas escapadas, saltos de línea internos y BOM', () => {
      const { rows, truncated } = parseCsv('﻿name,note\r\n"Doe, John","said ""hi"""\n"a\nb",2');
      expect(rows).toEqual([
        ['name', 'note'],
        ['Doe, John', 'said "hi"'],
        ['a\nb', '2'],
      ]);
      expect(truncated).toBe(false);
    });

    it('corta en maxRows y marca truncated si quedaba contenido', () => {
      const text = Array.from({ length: 10 }, (_, i) => `r${i},x`).join('\n');
      const { rows, truncated } = parseCsv(text, 3);
      expect(rows.length).toBe(3);
      expect(truncated).toBe(true);
    });

    it('no marca truncated si el corte coincide con el final', () => {
      expect(parseCsv('a\nb\n', 2).truncated).toBe(false);
    });

    it('corta columnas por encima de maxColumns', () => {
      const { rows, truncated } = parseCsv('1,2,3,4,5\n6,7', 100, 3);
      expect(rows).toEqual([
        ['1', '2', '3'],
        ['6', '7'],
      ]);
      expect(truncated).toBe(true);
    });

    it('texto vacío → sin filas', () => {
      expect(parseCsv('').rows).toEqual([]);
    });
  });

  it('stepZoom respeta los límites', () => {
    expect(stepZoom(1, 'in')).toBe(1.25);
    expect(stepZoom(1, 'out')).toBe(0.8);
    expect(stepZoom(MAX_ZOOM, 'in')).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, 'out')).toBe(MIN_ZOOM);
  });

  it('moveIndex no da la vuelta y clampIndex acota', () => {
    expect(moveIndex(0, -1, 3)).toBeNull();
    expect(moveIndex(2, 1, 3)).toBeNull();
    expect(moveIndex(1, 1, 3)).toBe(2);
    expect(clampIndex(9, 3)).toBe(2);
    expect(clampIndex(-4, 3)).toBe(0);
    expect(clampIndex(1, 0)).toBe(0);
  });

  it('parsePageInput acota a [1, pageCount] y rechaza basura', () => {
    expect(parsePageInput('3', 10)).toBe(3);
    expect(parsePageInput('99', 10)).toBe(10);
    expect(parsePageInput(0, 10)).toBe(1);
    expect(parsePageInput('abc', 10)).toBeNull();
    expect(parsePageInput('2', 0)).toBeNull();
  });

  it('friendlyViewerError nunca devuelve el texto técnico', () => {
    expect(friendlyViewerError(new ViewerHttpError(403))).toContain('expired');
    expect(friendlyViewerError(new ViewerHttpError(404))).toContain("couldn't find");
    expect(friendlyViewerError({ name: 'PasswordException', message: 'No password given' })).toContain('password');
    const generic = friendlyViewerError(new Error('Invalid XRef stream header'));
    expect(generic).not.toContain('XRef');
    expect(generic).toBe("We couldn't load this preview.");
  });
});
