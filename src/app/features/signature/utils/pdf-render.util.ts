import * as pdfjsLib from 'pdfjs-dist';

// El worker se sirve desde /pdfjs/ (copiado en angular.json, igual que ionicons).
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

export const DEFAULT_RENDER_SCALE = 1.2;

/** Página del documento renderizada a imagen (o en blanco cuando src === null). */
export interface RenderedPage {
  /** Página 1-based. */
  page: number;
  width: number;
  height: number;
  scale: number;
  /** data URL de la página renderizada; null = página en blanco (fallback). */
  src: string | null;
}

/** Renderiza todas las páginas de un PDF (bytes o URL) a data URLs vía pdf.js. */
export async function renderPdfPages(
  src: { data: Uint8Array } | { url: string },
  scale: number = DEFAULT_RENDER_SCALE,
): Promise<RenderedPage[]> {
  const pdf = await pdfjsLib.getDocument({ ...src, standardFontDataUrl: '/pdfjs/standard_fonts/' }).promise;
  const out: RenderedPage[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    out.push({ page: p, width: viewport.width, height: viewport.height, scale, src: canvas.toDataURL('image/png') });
  }
  return out;
}

/** Páginas en blanco tamaño carta como superficie de colocación (sin bytes de PDF). */
export function blankPages(count: number, scale: number = DEFAULT_RENDER_SCALE): RenderedPage[] {
  const width = Math.round(612 * scale);
  const height = Math.round(792 * scale);
  return Array.from({ length: count }, (_, i) => ({ page: i + 1, width, height, scale, src: null }));
}
