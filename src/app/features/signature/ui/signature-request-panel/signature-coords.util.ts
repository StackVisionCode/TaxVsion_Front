/** Métricas de una página renderizada del PDF. */
export interface PageMetrics {
  /** Escala de render (px de pantalla por punto PDF). */
  scale: number;
  /** Alto de la página renderizada, en px de pantalla. */
  height: number;
}

/** Rectángulo en puntos PDF (origen abajo-izquierda). */
export interface PdfRect {
  page: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
}

interface ScreenRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convierte un campo en px de pantalla (origen arriba-izquierda) a puntos PDF
 * (origen abajo-izquierda), replicando el transform del CRM legado:
 *   pdfX = x / scale
 *   pdfY = (pageHeightPx - y - height) / scale   ← inversión del eje Y
 *   pdfW = width / scale ; pdfH = height / scale
 */
export function screenRectToPdf(field: ScreenRect, metrics: PageMetrics): PdfRect {
  const scale = metrics.scale || 1;
  const round = (n: number): number => Math.round(n * 100) / 100;
  return {
    page: field.page,
    posX: round(field.x / scale),
    posY: round((metrics.height - field.y - field.height) / scale),
    width: round(field.width / scale),
    height: round(field.height / scale),
  };
}
