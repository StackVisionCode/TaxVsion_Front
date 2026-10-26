import type {
  RichTextBlock,
  RichTextDocument,
  RichTextInline,
} from '@shared/utils/data-collection/rich-text';

/**
 * Modelo de edición del editor rich text. El documento del engine se ve como una lista de líneas
 * (un párrafo, un encabezado o un ítem de lista) con tramos de formato. Las posiciones son planas:
 * las líneas se unen con `LINE_SEPARATOR`, que ocupa una posición pero no cuenta como carácter.
 * Todas las funciones son puras y nunca mutan las líneas que reciben.
 */

export const LINE_SEPARATOR = ' ';
export const MAX_CHARACTERS = 8000;
export const MAX_BLOCKS = 200;

export type Mark = 'bold' | 'italic' | 'underline';
export type LineType = 'paragraph' | 'heading2' | 'heading3' | 'bulletList' | 'orderedList';

export interface RunStyle {
  marks: Mark[];
  color: string | null;
  href: string | null;
}

export interface Run extends RunStyle {
  text: string;
}

export interface Line {
  type: LineType;
  align: string | null;
  font: string | null;
  runs: Run[];
}

export interface TextRange {
  start: number;
  end: number;
}

export const MARKS: readonly Mark[] = ['bold', 'italic', 'underline'];
export const EMPTY_STYLE: RunStyle = { marks: [], color: null, href: null };

export function emptyLine(): Line {
  return { type: 'paragraph', align: null, font: null, runs: [] };
}

export function isListType(type: LineType): type is 'bulletList' | 'orderedList' {
  return type === 'bulletList' || type === 'orderedList';
}

// ---------- Documento ↔ líneas ----------

export function fromDocument(document: RichTextDocument | null | undefined): Line[] {
  const lines: Line[] = [];
  const blocks = Array.isArray(document?.blocks) ? document.blocks : [];
  for (const block of blocks) {
    const align = block.align ?? null;
    const font = block.font ?? null;
    if (block.type === 'bulletList' || block.type === 'orderedList') {
      for (const item of block.items ?? [])
        lines.push({ type: block.type, align, font, runs: runsFromInlines(item, null) });
      continue;
    }
    const type: LineType =
      block.type === 'heading' ? (block.level === 3 ? 'heading3' : 'heading2') : 'paragraph';
    lines.push({ type, align, font, runs: runsFromInlines(block.children ?? [], null) });
  }
  return lines.length ? lines : [emptyLine()];
}

export function toDocument(lines: readonly Line[]): RichTextDocument {
  const blocks: RichTextBlock[] = [];
  for (const line of lines) {
    const inlines = inlinesFromRuns(line.runs);
    const props = {
      ...(line.align ? { align: line.align } : {}),
      ...(line.font ? { font: line.font } : {}),
    };
    if (isListType(line.type)) {
      const last = blocks.at(-1);
      if (
        last?.type === line.type &&
        (last.align ?? null) === line.align &&
        (last.font ?? null) === line.font
      ) {
        last.items!.push(inlines);
      } else {
        blocks.push({ type: line.type, ...props, items: [inlines] });
      }
    } else if (line.type === 'heading2' || line.type === 'heading3') {
      blocks.push({
        type: 'heading',
        level: line.type === 'heading3' ? 3 : 2,
        ...props,
        children: inlines,
      });
    } else {
      blocks.push({ type: 'paragraph', ...props, children: inlines });
    }
  }
  return { type: 'doc', blocks };
}

export function blockCount(lines: readonly Line[]): number {
  return toDocument(lines).blocks.length;
}

function runsFromInlines(nodes: readonly RichTextInline[], href: string | null): Run[] {
  return normalizeRuns(
    (Array.isArray(nodes) ? nodes : []).flatMap((node): Run[] =>
      node.type === 'link'
        ? runsFromInlines(node.children ?? [], node.href ?? null)
        : [
            {
              text: node.text ?? '',
              marks: cleanMarks(node.marks),
              color: node.color ?? null,
              href,
            },
          ],
    ),
  );
}

function inlinesFromRuns(runs: readonly Run[]): RichTextInline[] {
  // El engine exige al menos un inline por ítem de lista; el texto vacío es válido.
  if (!runs.length) return [{ type: 'text', text: '' }];
  const result: RichTextInline[] = [];
  for (const run of runs) {
    const text: RichTextInline = {
      type: 'text',
      text: run.text,
      ...(run.marks.length ? { marks: [...run.marks] } : {}),
      ...(run.color ? { color: run.color } : {}),
    };
    if (!run.href) {
      result.push(text);
      continue;
    }
    const last = result.at(-1);
    if (last?.type === 'link' && last.href === run.href) last.children!.push(text);
    else result.push({ type: 'link', href: run.href, children: [text] });
  }
  return result;
}

function cleanMarks(marks: readonly string[] | undefined): Mark[] {
  return MARKS.filter((mark) => (marks ?? []).includes(mark));
}

// ---------- Texto y posiciones ----------

export function lineText(line: Line): string {
  return line.runs.map((run) => run.text).join('');
}

export function plainText(lines: readonly Line[]): string {
  return lines.map(lineText).join(LINE_SEPARATOR);
}

export function characterCount(lines: readonly Line[]): number {
  return lines.reduce((total, line) => total + lineText(line).length, 0);
}

export function documentLength(lines: readonly Line[]): number {
  return plainText(lines).length;
}

export function locate(lines: readonly Line[], position: number): { line: number; offset: number } {
  let start = 0;
  for (let index = 0; index < lines.length; index++) {
    const length = lineText(lines[index]).length;
    if (position <= start + length) return { line: index, offset: Math.max(0, position - start) };
    start += length + 1;
  }
  const last = lines.length - 1;
  return { line: last, offset: lineText(lines[last]).length };
}

export function lineStart(lines: readonly Line[], index: number): number {
  let start = 0;
  for (let current = 0; current < index; current++) start += lineText(lines[current]).length + 1;
  return start;
}

/** Caracteres reales (sin separadores) dentro de un rango plano. */
export function charactersIn(lines: readonly Line[], range: TextRange): number {
  return plainText(lines).slice(range.start, range.end).split(LINE_SEPARATOR).join('').length;
}

// ---------- Estilo ----------

function charStyle(runs: readonly Run[], index: number): Run | null {
  if (index < 0) return null;
  let start = 0;
  for (const run of runs) {
    if (index < start + run.text.length) return run;
    start += run.text.length;
  }
  return null;
}

/** Estilo que hereda lo que se escribe en `position`: el del carácter anterior de la línea. */
export function styleAt(lines: readonly Line[], position: number): RunStyle {
  const { line, offset } = locate(lines, position);
  const runs = lines[line].runs;
  const before = charStyle(runs, offset - 1);
  const after = charStyle(runs, offset);
  const base = before ?? after;
  if (!base) return { ...EMPTY_STYLE, marks: [] };
  // Un link solo se extiende si se escribe dentro de él, no en su borde.
  const href = before && after && before.href === after.href ? before.href : null;
  return { marks: [...base.marks], color: base.color, href };
}

/** Estilo del primer carácter del rango (para reemplazos y para la barra). */
export function styleOfRange(lines: readonly Line[], range: TextRange): RunStyle {
  if (range.start === range.end) return styleAt(lines, range.start);
  const { line, offset } = locate(lines, range.start);
  const run = charStyle(lines[line].runs, offset) ?? styleAt(lines, range.start);
  return { marks: [...run.marks], color: run.color, href: run.href };
}

export function rangeHasMark(lines: readonly Line[], range: TextRange, mark: Mark): boolean {
  let found = false;
  let all = true;
  forEachRunIn(lines, range, (run) => {
    found = true;
    if (!run.marks.includes(mark)) all = false;
  });
  return found && all;
}

/** Extensión contigua del link que contiene `position` dentro de su línea. */
export function linkExtent(lines: readonly Line[], position: number): TextRange | null {
  const { line, offset } = locate(lines, position);
  const runs = lines[line].runs;
  const run = charStyle(runs, offset) ?? charStyle(runs, offset - 1);
  if (!run?.href) return null;
  const index = runs.indexOf(run);
  let first = index;
  let last = index;
  while (first > 0 && runs[first - 1].href === run.href) first--;
  while (last < runs.length - 1 && runs[last + 1].href === run.href) last++;
  const base = lineStart(lines, line);
  const from = runs.slice(0, first).reduce((total, item) => total + item.text.length, 0);
  const to = runs.slice(0, last + 1).reduce((total, item) => total + item.text.length, 0);
  return { start: base + from, end: base + to };
}

// ---------- Ediciones ----------

export function replaceRange(
  lines: readonly Line[],
  range: TextRange,
  text: string,
  style: RunStyle,
): Line[] {
  const from = locate(lines, Math.min(range.start, range.end));
  const to = locate(lines, Math.max(range.start, range.end));
  const first = lines[from.line];
  const last = lines[to.line];
  const left = sliceRuns(first.runs, 0, from.offset);
  const right = sliceRuns(last.runs, to.offset, Number.POSITIVE_INFINITY);
  const segments = text.split(LINE_SEPARATOR);
  // Enter al principio de la línea deja el formato de bloque en el texto que baja.
  const keepType = segments.length > 1 && from.offset === 0;
  const created = segments.map((segment, index): Line => {
    const runs: Run[] = [
      ...(index === 0 ? left : []),
      ...(segment
        ? [{ text: segment, marks: [...style.marks], color: style.color, href: style.href }]
        : []),
      ...(index === segments.length - 1 ? right : []),
    ];
    const type = index === 0 || keepType ? first.type : continuationType(first.type);
    return { type, align: first.align, font: first.font, runs: normalizeRuns(runs) };
  });
  return [...lines.slice(0, from.line), ...created, ...lines.slice(to.line + 1)];
}

export function mapRange(
  lines: readonly Line[],
  range: TextRange,
  transform: (run: Run) => Run,
): Line[] {
  let start = 0;
  return lines.map((line) => {
    const length = lineText(line).length;
    const lineFrom = start;
    start += length + 1;
    const from = Math.max(range.start, lineFrom) - lineFrom;
    const to = Math.min(range.end, lineFrom + length) - lineFrom;
    if (to <= from) return line;
    const runs = [
      ...sliceRuns(line.runs, 0, from),
      ...sliceRuns(line.runs, from, to).map(transform),
      ...sliceRuns(line.runs, to, Number.POSITIVE_INFINITY),
    ];
    return { ...line, runs: normalizeRuns(runs) };
  });
}

export function setMark(lines: readonly Line[], range: TextRange, mark: Mark, on: boolean): Line[] {
  return mapRange(lines, range, (run) => ({
    ...run,
    marks: on ? cleanMarks([...run.marks, mark]) : run.marks.filter((item) => item !== mark),
  }));
}

/** Índices de las líneas que toca el rango (la del cursor si está colapsado). */
export function linesInRange(lines: readonly Line[], range: TextRange): number[] {
  const first = locate(lines, range.start).line;
  const last = locate(lines, Math.max(range.start, range.end)).line;
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

export function setLineProps(
  lines: readonly Line[],
  range: TextRange,
  patch: Partial<Pick<Line, 'type' | 'align' | 'font'>>,
): Line[] {
  const touched = new Set(linesInRange(lines, range));
  return lines.map((line, index) => (touched.has(index) ? { ...line, ...patch } : line));
}

/**
 * Cambio mínimo entre el texto del modelo y el del DOM. `caret` (posición final en el DOM) desempata
 * cuando el texto se repite, para ubicar la inserción donde realmente quedó el cursor.
 */
export function textDiff(
  before: string,
  after: string,
  caret: number | null,
): { start: number; end: number; text: string } | null {
  if (before === after) return null;
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before[prefix] === after[prefix]) prefix++;
  if (caret != null) {
    const inserted = Math.max(0, after.length - before.length);
    prefix = Math.min(prefix, Math.max(0, caret - inserted));
  }
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  return {
    start: prefix,
    end: before.length - suffix,
    text: after.slice(prefix, after.length - suffix),
  };
}

function continuationType(type: LineType): LineType {
  return type === 'heading2' || type === 'heading3' ? 'paragraph' : type;
}

function forEachRunIn(lines: readonly Line[], range: TextRange, visit: (run: Run) => void): void {
  let start = 0;
  for (const line of lines) {
    const length = lineText(line).length;
    const from = Math.max(range.start, start) - start;
    const to = Math.min(range.end, start + length) - start;
    if (to > from) sliceRuns(line.runs, from, to).forEach(visit);
    start += length + 1;
  }
}

function sliceRuns(runs: readonly Run[], from: number, to: number): Run[] {
  const result: Run[] = [];
  let start = 0;
  for (const run of runs) {
    const end = start + run.text.length;
    const sliceFrom = Math.max(from, start);
    const sliceTo = Math.min(to, end);
    if (sliceTo > sliceFrom)
      result.push({
        ...run,
        marks: [...run.marks],
        text: run.text.slice(sliceFrom - start, sliceTo - start),
      });
    start = end;
  }
  return result;
}

function normalizeRuns(runs: readonly Run[]): Run[] {
  const result: Run[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = result.at(-1);
    if (last && sameStyle(last, run))
      result[result.length - 1] = { ...last, text: last.text + run.text };
    else result.push({ ...run, marks: cleanMarks(run.marks) });
  }
  return result;
}

function sameStyle(left: RunStyle, right: RunStyle): boolean {
  return (
    left.color === right.color &&
    left.href === right.href &&
    MARKS.every((mark) => left.marks.includes(mark) === right.marks.includes(mark))
  );
}
