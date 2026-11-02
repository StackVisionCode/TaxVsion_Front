/**
 * Regla del tamaño de letra del estampado, compartida con el sellador (`FieldTypography` +
 * `PdfSharpSealingEngine` del backend). Los números (rango automático, proporción del alto, piso)
 * llegan del backend en los límites vigentes; aquí solo vive la fórmula:
 *
 *   inicio = fontSizePt elegido ?? clamp(alto de la caja × autoHeightRatio, autoFontMinPt, autoFontMaxPt)
 *   y solo se achica (de 0.5 en 0.5, hasta minFontSizePt) si el texto no cabe en la caja. Nunca crece.
 */
import type { FieldType } from '../ui/signature-request-panel/signature-wizard.model';

/** Parámetros de la regla, tal como los devuelve GET /signature/settings/effective-limits (o la vista pública). */
export interface StampTypography {
  readonly autoFontMinPt: number;
  readonly autoFontMaxPt: number;
  readonly autoHeightRatio: number;
  /** Piso al achicar (el sellador no baja de aquí). */
  readonly minFontSizePt: number;
}

/** Fuente con la que el sellador dibuja cada tipo (Helvetica → Arial en el servidor). */
export interface StampTypeface {
  readonly family: string;
  readonly weight: 'normal' | 'bold';
  readonly style: 'normal' | 'italic';
}

export const INITIALS_TYPEFACE: StampTypeface = { family: '"Times New Roman", Times, serif', weight: 'bold', style: 'italic' };
export const TEXT_TYPEFACE: StampTypeface = { family: 'Helvetica, Arial, sans-serif', weight: 'normal', style: 'normal' };

/** Alto de línea / tamaño (métricas de Arial y Times en PdfSharp ≈ 1.15). */
export const STAMP_LINE_HEIGHT = 1.15;
const SHRINK_STEP = 0.5;

/** Tipos cuyo contenido es texto con tamaño elegible (la firma es tinta). */
export function hasFontSize(type: FieldType): boolean {
  return type === 'initials' || type === 'date' || type === 'text';
}

/** Tamaño con el que arranca el sellador, antes de achicar. */
export function startingFontSize(fontSizePt: number | null | undefined, boxHeightPt: number, rule: StampTypography): number {
  if (fontSizePt != null) {
    return fontSizePt;
  }
  return Math.min(Math.max(Math.max(0, boxHeightPt) * rule.autoHeightRatio, rule.autoFontMinPt), rule.autoFontMaxPt);
}

/** Mide el ancho en pt de un texto a un tamaño dado (canvas en el navegador; inyectable en tests). */
export type StampTextMeasurer = (text: string, sizePt: number, typeface: StampTypeface) => number;

/** Una línea (iniciales, fecha): achica hasta que quepa a lo ancho y a lo alto, como `DrawSingleLine`. */
export function fitSingleLine(
  text: string,
  startPt: number,
  box: { widthPt: number; heightPt: number },
  rule: StampTypography,
  typeface: StampTypeface,
  measure: StampTextMeasurer = canvasMeasurer,
): number {
  let size = startPt;
  while (
    size > rule.minFontSizePt &&
    (measure(text, size, typeface) > box.widthPt || size * STAMP_LINE_HEIGHT > box.heightPt)
  ) {
    size -= SHRINK_STEP;
  }
  return size;
}

/** Texto libre: achica hasta que el bloque (con salto por ancho) quepa en el alto, como `DrawWrappedText`. */
export function fitWrappedText(
  text: string,
  startPt: number,
  box: { widthPt: number; heightPt: number },
  rule: StampTypography,
  measure: StampTextMeasurer = canvasMeasurer,
): number {
  let size = startPt;
  while (
    size > rule.minFontSizePt &&
    wrapLineCount(text, size, box.widthPt, measure) * size * STAMP_LINE_HEIGHT > box.heightPt
  ) {
    size -= SHRINK_STEP;
  }
  return size;
}

function wrapLineCount(text: string, sizePt: number, maxWidthPt: number, measure: StampTextMeasurer): number {
  let lines = 0;
  for (const paragraph of text.split(/\r?\n/)) {
    let current = '';
    lines++;
    for (const word of paragraph.split(' ').filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && measure(candidate, sizePt, TEXT_TYPEFACE) > maxWidthPt) {
        lines++;
        current = word;
      } else {
        current = candidate;
      }
    }
  }
  return Math.max(1, lines);
}

/** Iniciales como las estampa el sellador: primera letra de cada palabra, hasta 4, en mayúsculas. */
export function toInitials(fullName: string): string {
  const initials = fullName
    .split(' ')
    .filter((part) => part.length > 0 && /\p{L}/u.test(part[0]!))
    .map((part) => part[0]!.toLocaleUpperCase('en-US'))
    .slice(0, 4)
    .join('');
  return initials || '—';
}

/** Formatea una fecha con el patrón .NET del backend (solo yyyy, MM, dd: los formatos de estampado). */
export function formatStampDate(date: Date, pattern: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return pattern
    .replace('yyyy', String(date.getFullYear()))
    .replace('MM', pad(date.getMonth() + 1))
    .replace('dd', pad(date.getDate()));
}

/** Tamaños que ofrecen los inspectores, filtrados por el rango permitido que manda el backend. */
const FONT_SIZE_PRESETS = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];

export function fontSizeOptions(range: { minFontSizePt: number; maxFontSizePt: number }): number[] {
  return FONT_SIZE_PRESETS.filter((size) => size >= range.minFontSizePt && size <= range.maxFontSizePt);
}

/** Vista previa del estampado de un campo: lo que quedará en el PDF, a escala de pantalla. */
export interface StampPreview {
  text: string;
  /** Letra final en pt (tras achicar si no cabía). */
  pt: number;
  /** true = el preparador no eligió letra (automática según la caja). */
  auto: boolean;
  /** true = se achicó para caber (la letra elegida no entraba). */
  shrunk: boolean;
  /** CSS `font` a escala de la página renderizada. */
  font: string;
  lineHeightPx: number;
  align: 'center' | 'left';
  wrap: boolean;
  /** Texto de muestra (la etiqueta del campo de texto): el valor real lo escribe el firmante. */
  sample: boolean;
}

/** Campo en px de pantalla (cualquiera de los dos editores) y lo que se estampará en él. */
export interface StampPreviewInput {
  type: FieldType;
  width: number;
  height: number;
  fontSizePt?: number | null;
  /** Iniciales: nombre del firmante (o rol en plantillas); fecha: hoy ya formateado; texto: la etiqueta. */
  content: string;
}

/** Misma regla que el sellador, a la escala de la página (`scale` = px por pt). null si el tipo no lleva letra. */
export function stampPreview(input: StampPreviewInput, scale: number, rule: StampTypography): StampPreview | null {
  if (scale <= 0 || !hasFontSize(input.type)) {
    return null;
  }
  const box = { widthPt: input.width / scale, heightPt: input.height / scale };
  const start = startingFontSize(input.fontSizePt, box.heightPt, rule);
  const isText = input.type === 'text';
  const typeface = input.type === 'initials' ? INITIALS_TYPEFACE : TEXT_TYPEFACE;
  const text = input.type === 'initials' ? toInitials(input.content) : isText ? input.content || 'Signer text' : input.content;
  const pt = isText ? fitWrappedText(text, start, box, rule) : fitSingleLine(text, start, box, rule, typeface);
  const px = pt * scale;
  return {
    text,
    pt,
    auto: input.fontSizePt == null,
    shrunk: pt < start,
    font: cssFont(typeface, px),
    lineHeightPx: px * STAMP_LINE_HEIGHT,
    align: input.type === 'initials' ? 'center' : 'left',
    wrap: isText,
    sample: isText,
  };
}

/** CSS `font` para un tamaño en px de pantalla (canvas y vista previa usan la misma cadena). */
export function cssFont(typeface: StampTypeface, sizePx: number): string {
  return `${typeface.style} ${typeface.weight} ${sizePx}px ${typeface.family}`;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Medidor por defecto: canvas 2D (1 px = 1 pt al medir); sin canvas (SSR/tests) estima 0.5 em por carácter. */
const canvasMeasurer: StampTextMeasurer = (text, sizePt, typeface) => {
  if (measureContext === undefined) {
    measureContext = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  }
  if (!measureContext) {
    return text.length * sizePt * 0.5;
  }
  measureContext.font = cssFont(typeface, sizePt);
  return measureContext.measureText(text).width;
};
