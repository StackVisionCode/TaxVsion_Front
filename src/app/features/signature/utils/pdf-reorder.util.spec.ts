import { vi } from 'vitest';

const extractPages = vi.fn(async () => new Uint8Array([1, 2, 3]));
const destroy = vi.fn(async () => undefined);
let numPages = 3;

// Se simula pdf.js (el worker real no corre en jsdom): lo que importa es qué páginas se le piden y en qué orden.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({ numPages, extractPages }),
    destroy,
  }),
}));

import { buildExtractRequest, isValidPageOrder, movePageInOrder, reorderPdfPages } from './pdf-reorder.util';

describe('pdf-reorder.util', () => {
  beforeEach(() => {
    extractPages.mockClear();
    destroy.mockClear();
    numPages = 3;
  });

  it('movePageInOrder mueve un elemento sin mutar el original', () => {
    const order = [1, 2, 3, 4];
    expect(movePageInOrder(order, 0, 2)).toEqual([2, 3, 1, 4]);
    expect(movePageInOrder(order, 3, 0)).toEqual([4, 1, 2, 3]);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('isValidPageOrder exige una permutación completa', () => {
    expect(isValidPageOrder([2, 1, 3], 3)).toBe(true);
    expect(isValidPageOrder([1, 1, 3], 3)).toBe(false);
    expect(isValidPageOrder([1, 2], 3)).toBe(false);
    expect(isValidPageOrder([1, 2, 4], 3)).toBe(false);
  });

  it('buildExtractRequest fija la página original y la posición de cada destino', () => {
    expect(buildExtractRequest([3, 1, 2])).toEqual([
      { document: null, includePages: [2], pageIndices: [0] },
      { document: null, includePages: [0], pageIndices: [1] },
      { document: null, includePages: [1], pageIndices: [2] },
    ]);
  });

  it('reorderPdfPages pide a pdf.js las páginas en el nuevo orden y libera el documento', async () => {
    const bytes = await reorderPdfPages(new Blob([new Uint8Array([37, 80, 68, 70])]), [3, 1, 2]);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(extractPages).toHaveBeenCalledWith(buildExtractRequest([3, 1, 2]));
    expect(destroy).toHaveBeenCalled();
  });

  it('rechaza un orden que no corresponde al documento (y no extrae nada)', async () => {
    numPages = 2;
    await expect(reorderPdfPages(new Blob([new Uint8Array([1])]), [1, 1])).rejects.toThrow(/does not match/);
    expect(extractPages).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });
});
