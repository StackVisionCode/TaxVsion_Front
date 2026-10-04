import {
  PDF_RENDER_FRIENDLY_ERROR,
  blankPages,
  isPdfRenderAborted,
  renderPdfPages,
} from './pdf-render.util';

describe('pdf-render.util', () => {
  it('un render ya cancelado rechaza con PdfRenderAbortedError sin cargar pdf.js', async () => {
    const abort = new AbortController();
    abort.abort();
    const err = await renderPdfPages({ data: new Uint8Array() }, 1, { signal: abort.signal }).catch(
      (e) => e,
    );
    expect(isPdfRenderAborted(err)).toBe(true);
  });

  it('el mensaje al usuario no es el técnico de pdf.js', () => {
    expect(PDF_RENDER_FRIENDLY_ERROR).toBe(
      "We couldn't open this PDF. Try again or upload another file.",
    );
  });

  it('blankPages: carta a la escala pedida', () => {
    expect(blankPages(2, 1)).toEqual([
      { page: 1, width: 612, height: 792, scale: 1, src: null },
      { page: 2, width: 612, height: 792, scale: 1, src: null },
    ]);
  });
});
