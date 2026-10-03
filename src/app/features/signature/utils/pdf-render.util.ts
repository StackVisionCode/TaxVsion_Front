type PdfJs = typeof import('pdfjs-dist');

/**
 * pdf.js se carga BAJO DEMANDA, no con un import estático.
 *
 * Es la dependencia más pesada del proyecto (~430 kB sin comprimir) y con el import
 * estático viajaba en el chunk de Signature entero: abrir la lista de solicitudes —o la
 * página de plantillas— ya la pagaba, aunque no se llegara a abrir ningún PDF. Al moverla
 * aquí, solo la descarga quien de verdad renderiza un documento.
 *
 * La promesa se memoiza: varias llamadas concurrentes comparten una sola carga, y el
 * worker se configura una única vez.
 */
let pdfjs: Promise<PdfJs> | null = null;

function loadPdfjs(): Promise<PdfJs> {
  pdfjs ??= import('pdfjs-dist')
    .then(lib => {
      // El worker se sirve desde /pdfjs/ (copiado en angular.json, igual que ionicons).
      lib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      return lib;
    })
    .catch(err => {
      // Un fallo de red no debe dejar la promesa rota cacheada para siempre: se suelta
      // para que el siguiente intento vuelva a bajarla.
      pdfjs = null;
      throw err;
    });
  return pdfjs;
}

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

/** Error lanzado cuando un render se cancela con `signal` (un render más nuevo lo reemplazó). */
export class PdfRenderAbortedError extends Error {
  constructor() {
    super('PDF render aborted');
    this.name = 'PdfRenderAbortedError';
  }
}

export function isPdfRenderAborted(err: unknown): boolean {
  return err instanceof PdfRenderAbortedError;
}

/** Mensaje para el usuario cuando no se puede abrir/renderizar un PDF (nunca el err.message técnico de pdf.js). */
export const PDF_RENDER_FRIENDLY_ERROR = "We couldn't open this PDF. Try again or upload another file.";

export interface RenderPdfOptions {
  /** Cancela el render (se comprueba entre páginas); rechaza con PdfRenderAbortedError. */
  signal?: AbortSignal;
}

/**
 * Renderiza todas las páginas de un PDF (bytes o URL) a data URLs vía pdf.js.
 *
 * - `scale` puede ser un número o una función que recibe el ancho en puntos PDF de la página 1
 *   y devuelve la escala (p. ej. "ajustar al ancho" sin un segundo render).
 * - `options.signal` permite cancelar un render viejo (zoom rápido, cambio de documento).
 * - El documento de pdf.js se libera siempre (`loadingTask.destroy()`), salga bien, mal o cancelado.
 */
export async function renderPdfPages(
  src: { data: Uint8Array } | { url: string },
  scale: number | ((firstPageWidthPts: number) => number) = DEFAULT_RENDER_SCALE,
  options: RenderPdfOptions = {},
): Promise<RenderedPage[]> {
  const { signal } = options;
  const throwIfAborted = (): void => {
    if (signal?.aborted) {
      throw new PdfRenderAbortedError();
    }
  };
  throwIfAborted();
  const lib = await loadPdfjs();
  throwIfAborted();
  const task = lib.getDocument({ ...src, standardFontDataUrl: '/pdfjs/standard_fonts/' });
  try {
    const pdf = await task.promise;
    const out: RenderedPage[] = [];
    let resolvedScale = typeof scale === 'number' ? scale : DEFAULT_RENDER_SCALE;
    for (let p = 1; p <= pdf.numPages; p++) {
      throwIfAborted();
      const page = await pdf.getPage(p);
      if (p === 1 && typeof scale === 'function') {
        resolvedScale = scale(page.getViewport({ scale: 1 }).width);
      }
      const viewport = page.getViewport({ scale: resolvedScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      out.push({
        page: p,
        width: viewport.width,
        height: viewport.height,
        scale: resolvedScale,
        src: canvas.toDataURL('image/png'),
      });
      page.cleanup();
    }
    throwIfAborted();
    return out;
  } finally {
    // Libera el worker/memoria del documento (destroy de la tarea = pdf.destroy()): antes cada
    // zoom/retry dejaba un PDFDocumentProxy vivo. También si la carga falló o se canceló.
    void task.destroy();
  }
}

/** Páginas en blanco tamaño carta como superficie de colocación (sin bytes de PDF). */
export function blankPages(count: number, scale: number = DEFAULT_RENDER_SCALE): RenderedPage[] {
  const width = Math.round(612 * scale);
  const height = Math.round(792 * scale);
  return Array.from({ length: count }, (_, i) => ({ page: i + 1, width, height, scale, src: null }));
}
