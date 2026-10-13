import { PDFJS_STANDARD_FONTS_URL, loadPdfjs } from '@shared/utils/pdfjs-loader';

/**
 * Reordena las páginas de un PDF en el navegador con el propio pdf.js (`extractPages`), que ya viaja con
 * el editor: no hace falta otra librería. `order` es la secuencia de páginas ORIGINALES (1-based) en su
 * nuevo orden: [2, 1, 3] = la página 2 pasa a ser la primera. Devuelve los bytes del PDF nuevo.
 */
export async function reorderPdfPages(source: Blob, order: readonly number[]): Promise<Uint8Array> {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(await source.arrayBuffer()),
    standardFontDataUrl: PDFJS_STANDARD_FONTS_URL,
  });
  try {
    const pdf = await task.promise;
    if (!isValidPageOrder(order, pdf.numPages)) {
      throw new Error('The new page order does not match the document.');
    }
    return await pdf.extractPages(buildExtractRequest(order));
  } finally {
    void task.destroy();
  }
}

/**
 * Una entrada por página de destino: cada una trae su página original y la posición exacta que ocupará,
 * así el orden pedido se respeta aunque pdf.js normalice los rangos de una sola entrada.
 */
export function buildExtractRequest(order: readonly number[]): { document: null; includePages: number[]; pageIndices: number[] }[] {
  return order.map((original, position) => ({
    document: null,
    includePages: [original - 1],
    pageIndices: [position],
  }));
}

/** `order` debe ser una permutación de 1..total, sin repetidos ni huecos. */
export function isValidPageOrder(order: readonly number[], total: number): boolean {
  if (order.length !== total) {
    return false;
  }
  const seen = new Set(order);
  return seen.size === total && order.every((page) => Number.isInteger(page) && page >= 1 && page <= total);
}

/** Mueve un elemento de `from` a `to` en una copia del arreglo (orden nuevo de las páginas). */
export function movePageInOrder(order: readonly number[], from: number, to: number): number[] {
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
