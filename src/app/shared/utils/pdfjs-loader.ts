type PdfJs = typeof import('pdfjs-dist');

/**
 * Carga de pdf.js BAJO DEMANDA para piezas compartidas (visor de archivos). Es la dependencia más
 * pesada del proyecto: con un import estático viajaría en el chunk de cada pantalla que monta el
 * visor aunque nunca se abra un PDF.
 *
 * Réplica mínima del cargador de `features/signature/utils/pdf-render.util.ts` (shared no puede
 * importar de features). La promesa se memoiza y el worker se configura una sola vez; si la carga
 * falla, se suelta para que el siguiente intento vuelva a bajarla.
 */
let pdfjs: Promise<PdfJs> | null = null;

export function loadPdfjs(): Promise<PdfJs> {
  pdfjs ??= import('pdfjs-dist')
    .then(lib => {
      // El worker y las fuentes se sirven desde /pdfjs/ (copiados en angular.json).
      lib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      return lib;
    })
    .catch(err => {
      pdfjs = null;
      throw err;
    });
  return pdfjs;
}

/** Ruta de las fuentes estándar para `getDocument` (sin ellas, PDFs sin fuentes embebidas fallan). */
export const PDFJS_STANDARD_FONTS_URL = '/pdfjs/standard_fonts/';
