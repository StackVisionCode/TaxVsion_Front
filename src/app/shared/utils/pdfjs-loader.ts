type PdfJs = typeof import('pdfjs-dist');

/**
 * Carga de pdf.js BAJO DEMANDA (visor global de archivos y editor de Signature).
 *
 * Es la dependencia más pesada del proyecto (~430 kB sin comprimir): con un import estático
 * viajaría en el chunk de cada pantalla que monta el visor aunque nunca se abra un PDF.
 *
 * La promesa se memoiza (varias llamadas concurrentes comparten una sola carga) y el worker se
 * configura una única vez. Si la carga falla (red), se suelta para que el siguiente intento vuelva
 * a bajarla en vez de dejar una promesa rota cacheada para siempre.
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
