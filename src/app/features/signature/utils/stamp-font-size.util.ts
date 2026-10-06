/**
 * F6 — Réplica EXACTA de las fórmulas de `PdfSharpSealingEngine` para predecir el tamaño de letra
 * del sellado mientras el preparador redimensiona la caja. El dominio NO guarda el tamaño: lo
 * calcula el sellador por kind + alto de caja. Esta función reproduce ese cálculo para que el
 * editor pueda pintar el número en vivo.
 *
 * ⚠ Cuando el backend cambie la fórmula (`PdfSharpSealingEngine.*`), este util y su spec deben
 *   actualizarse en el mismo PR (criterio de aceptación F6 del audit).
 */
export type StampFieldKind = 'signature' | 'initials' | 'date' | 'text';

export interface StampFontSizeResult {
  /** Tamaño en puntos redondeado a entero (el editor pinta "N pt"). */
  readonly pt: number;
  /**
   * true si el sellado puede ACHICARLO adicionalmente para que el texto quepa a lo ancho
   * (Text/Date). Signature e Initials no se achican por el texto (el audit lo documenta en §4.3).
   */
  readonly mayShrink: boolean;
}

/**
 * Decide el tamaño inicial que usará el sealing engine. Para Signature e Initials el valor es
 * determinista (el usuario no escribe nada que pudiera medirse). Para Text/Date es el "starting
 * size" del `FitFontSize` del backend antes del posible achique por ancho.
 */
export function stampFontSizeForBox(kind: StampFieldKind, heightPx: number, _widthPx?: number): StampFontSizeResult {
  const h = Math.max(0, heightPx);
  switch (kind) {
    case 'signature':
      return { pt: clampRound(signatureBand(h) * 0.72, 9, 24), mayShrink: false };
    case 'initials':
      // FitFontSize parte de maxHeight*0.8 con maxHeight = h*0.55; para 2-3 letras no se achica por ancho.
      return { pt: clampRound(h * 0.55 * 0.8, 6, 20), mayShrink: false };
    case 'text':
    case 'date':
      // FitFontSize parte de h*0.8; el firmante puede escribir texto largo que lo achique por ancho.
      return { pt: clampRound(h * 0.8, 6, 18), mayShrink: true };
  }
}

// Reglas internas del DrawSignatureStamp del backend (PdfSharpSealingEngine.cs ~línea 192-196).
// El caption solo aparece sobre cajas >= 34pt; metaBand y gap siempre existen.
function signatureBand(h: number): number {
  const captionBand = h >= 34 ? Math.min(10, h * 0.2) : 0;
  const metaBand = Math.min(11, h * 0.24);
  const gap = Math.min(2, h * 0.04);
  return Math.max(1, h - captionBand - metaBand - gap);
}

function clampRound(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max));
}
