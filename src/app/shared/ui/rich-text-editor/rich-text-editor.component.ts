import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  Renderer2,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { RichTextDocument } from '@shared/utils/data-collection/rich-text';
import { canonicalizeRichText } from '@shared/utils/data-collection/rich-text';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import {
  EMPTY_STYLE,
  LINE_SEPARATOR,
  MARKS,
  MAX_BLOCKS,
  MAX_CHARACTERS,
  blockCount,
  characterCount,
  charactersIn,
  documentLength,
  emptyLine,
  fromDocument,
  isListType,
  linkExtent,
  locate,
  plainText,
  rangeHasMark,
  replaceRange,
  setLineProps,
  setMark,
  mapRange,
  styleAt,
  styleOfRange,
  textDiff,
  toDocument,
  type Line,
  type LineType,
  type Mark,
  type Run,
  type RunStyle,
  type TextRange,
} from './rich-text-editor.model';

interface Snapshot {
  lines: Line[];
  selection: TextRange;
}

type EditKind = 'typing' | 'delete' | 'format' | 'structure';

// Tipos de la composición (los dos últimos son de Safari): no se cancelan, se reconcilian.
const COMPOSITION_INPUTS = new Set([
  'insertCompositionText',
  'deleteCompositionText',
  'insertFromComposition',
]);

// Mapas token → clase literal (JIT de Tailwind); mismos tonos que app-dc-markdown.
const COLOR_CLASSES: Record<string, string> = {
  ink: 'text-gray-900',
  secondary: 'text-gray-700',
  muted: 'text-gray-600',
  brand: 'text-brand-bold',
  accent: 'text-orange-700',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-red-700',
  info: 'text-sky-700',
};
const ALIGN_CLASSES: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
};
const FONT_CLASSES: Record<string, string> = {
  sans: 'font-sans',
  serif: 'font-serif',
  script1: 'font-script1',
  script2: 'font-script2',
};
const MARK_CLASSES: Record<Mark, string> = {
  bold: 'font-bold',
  italic: 'italic',
  underline: 'underline',
};
const LINE_CLASSES: Record<LineType, string[]> = {
  paragraph: ['my-1'],
  heading2: ['my-2', 'text-xl', 'font-semibold'],
  heading3: ['my-2', 'text-lg', 'font-semibold'],
  bulletList: [],
  orderedList: [],
};

/**
 * Editor de RichText (P-20.2). El modelo de líneas es la fuente de verdad: cada `beforeinput` se
 * aplica al modelo y la superficie se vuelve a pintar con Renderer2 (nunca `innerHTML`). Lo que el
 * navegador cambia sin pasar por `beforeinput` (IME, autocorrector, teclados Android) se reconcilia
 * comparando el texto del DOM con el del modelo.
 */
@Component({
  selector: 'app-rich-text-editor',
  imports: [ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="overflow-hidden rounded-2xl border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-brand-light"
    >
      <div
        class="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50 p-2"
        role="toolbar"
        aria-label="Text formatting"
      >
        <button
          type="button"
          class="tool font-bold"
          aria-label="Bold"
          [attr.aria-pressed]="hasMark('bold')"
          (mousedown)="$event.preventDefault()"
          (click)="toggleMark('bold')"
        >
          B
        </button>
        <button
          type="button"
          class="tool italic"
          aria-label="Italic"
          [attr.aria-pressed]="hasMark('italic')"
          (mousedown)="$event.preventDefault()"
          (click)="toggleMark('italic')"
        >
          I
        </button>
        <button
          type="button"
          class="tool underline"
          aria-label="Underline"
          [attr.aria-pressed]="hasMark('underline')"
          (mousedown)="$event.preventDefault()"
          (click)="toggleMark('underline')"
        >
          U
        </button>
        <select
          class="tool-select"
          aria-label="Block type"
          [value]="currentLine().type"
          (change)="setBlockType($event)"
        >
          <option value="paragraph">Paragraph</option>
          <option value="heading2">Heading 2</option>
          <option value="heading3">Heading 3</option>
          <option value="bulletList">Bulleted list</option>
          <option value="orderedList">Numbered list</option>
        </select>
        <select
          class="tool-select"
          aria-label="Alignment"
          [value]="currentLine().align || 'left'"
          (change)="setAlign($event)"
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
          <option value="justify">Justify</option>
        </select>
        <select
          class="tool-select"
          aria-label="Font"
          [value]="currentLine().font || 'sans'"
          (change)="setFont($event)"
        >
          <option value="sans">Sans</option>
          <option value="serif">Serif</option>
          <option value="script1">Script 1</option>
          <option value="script2">Script 2</option>
        </select>
        <select
          class="tool-select"
          aria-label="Text color"
          [value]="activeStyle().color || 'ink'"
          (change)="setColor($event)"
        >
          <option value="ink">Ink</option>
          <option value="secondary">Secondary</option>
          <option value="muted">Muted</option>
          <option value="brand">Brand</option>
          <option value="accent">Accent</option>
          <option value="success">Success</option>
          <option value="warning">Warning</option>
          <option value="danger">Danger</option>
          <option value="info">Info</option>
        </select>
        <button
          type="button"
          class="tool"
          aria-label="Add HTTPS link"
          [attr.aria-pressed]="activeStyle().href != null"
          (mousedown)="$event.preventDefault()"
          (click)="openLinkDialog()"
        >
          Link
        </button>
      </div>
      <div
        #surface
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        [attr.aria-label]="ariaLabelledby ? null : ariaLabel"
        [attr.aria-labelledby]="ariaLabelledby"
        class="min-h-28 whitespace-pre-wrap break-words p-3 text-sm text-gray-900 outline-none"
        (beforeinput)="beforeInput($event)"
        (input)="onInput($event)"
        (compositionstart)="compositionStart()"
        (compositionend)="compositionEnd()"
        (paste)="paste($event)"
        (keydown)="keyDown($event)"
        (keyup)="captureSelection()"
        (mouseup)="captureSelection()"
        (focus)="captureSelection()"
        (blur)="captureSelection()"
      ></div>
      <div class="border-t border-gray-100 px-3 py-2 text-right text-xs text-gray-500">
        {{ characterTotal() }} / {{ maxCharacters }}
      </div>
    </div>

    <app-modal [isOpen]="linkOpen()" heading="Link" size="sm" (closed)="closeLinkDialog()">
      <form class="space-y-4 p-6" (submit)="applyLink($event)">
        <label class="block text-sm font-semibold text-gray-700"
          >HTTPS address
          <input
            type="url"
            inputmode="url"
            autocomplete="off"
            placeholder="https://"
            class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3"
            [attr.aria-invalid]="linkError() ? true : null"
            [value]="linkUrl()"
            (input)="linkUrl.set(inputValue($event))"
          />
        </label>
        @if (linkError()) {
          <p class="text-sm text-red-700" role="alert">{{ linkError() }}</p>
        }
        <div class="flex flex-wrap justify-end gap-3">
          @if (linkEditing()) {
            <button
              type="button"
              class="mr-auto min-h-10 rounded-full px-2 text-sm font-semibold text-red-700"
              (click)="removeLink()"
            >
              Remove link
            </button>
          }
          <button
            type="button"
            class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold"
            (click)="closeLinkDialog()"
          >
            Cancel
          </button>
          <button type="submit" class="min-h-10 rounded-full bg-brand-bold px-4 text-sm font-bold text-white">
            Apply
          </button>
        </div>
      </form>
    </app-modal>
  `,
  styles: [
    `
      .tool {
        display: inline-flex;
        height: 2rem;
        min-width: 2rem;
        align-items: center;
        justify-content: center;
        border-radius: 9999px;
        padding: 0 0.5rem;
        font-size: 0.75rem;
        color: #374151;
      }
      .tool:hover,
      .tool[aria-pressed='true'] {
        background: #fff;
        color: #1e466b;
        box-shadow: 0 0 0 1px #d1d5db;
      }
      .tool-select {
        min-height: 2rem;
        border: 1px solid #e5e7eb;
        border-radius: 9999px;
        background: #fff;
        padding: 0 0.5rem;
        font-size: 0.75rem;
      }
    `,
  ],
})
export class RichTextEditorComponent implements AfterViewInit {
  private readonly renderer = inject(Renderer2);
  @ViewChild('surface', { static: true }) private surface!: ElementRef<HTMLDivElement>;

  /** Nombre accesible de la superficie; se ignora si llega `ariaLabelledby`. */
  @Input() ariaLabel = 'Rich text content';
  @Input() ariaLabelledby: string | null = null;
  @Output() readonly documentChange = new EventEmitter<RichTextDocument>();

  readonly maxCharacters = MAX_CHARACTERS;
  private readonly lines = signal<Line[]>([emptyLine()]);
  private readonly selection = signal<TextRange>({ start: 0, end: 0 });
  // Formato elegido con el cursor colapsado; se aplica a lo próximo que se escriba ahí.
  private readonly pending = signal<{ position: number; style: RunStyle } | null>(null);
  private lastEmitted: string | null = null;
  private composing = false;
  private viewReady = false;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private lastEdit: EditKind | null = null;

  readonly linkOpen = signal(false);
  readonly linkUrl = signal('');
  readonly linkError = signal<string | null>(null);
  readonly linkEditing = signal(false);
  private linkRange: TextRange | null = null;

  readonly characterTotal = computed(() => characterCount(this.lines()));
  readonly currentLine = computed(() => {
    const lines = this.lines();
    return lines[locate(lines, this.selection().start).line] ?? emptyLine();
  });
  readonly activeStyle = computed<RunStyle>(() => {
    const lines = this.lines();
    const range = this.selection();
    const pending = this.pending();
    if (range.start === range.end)
      return pending?.position === range.start ? pending.style : styleAt(lines, range.start);
    const first = styleOfRange(lines, range);
    return { ...first, marks: MARKS.filter((mark) => rangeHasMark(lines, range, mark)) };
  });

  @Input() set document(value: RichTextDocument | null) {
    // El eco de lo que acabamos de emitir no se repinta: perdería el cursor o la composición.
    if (value && this.lastEmitted != null && canonicalizeRichText(value) === this.lastEmitted)
      return;
    this.lastEmitted = null;
    this.lines.set(fromDocument(value));
    this.pending.set(null);
    this.undoStack = [];
    this.redoStack = [];
    this.lastEdit = null;
    if (this.viewReady) this.render();
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.render();
  }

  hasMark(mark: Mark): boolean {
    return this.activeStyle().marks.includes(mark);
  }

  // ---------- Eventos de la superficie ----------

  beforeInput(event: InputEvent): void {
    // La composición (IME) la maneja el navegador; se reconcilia en compositionend.
    if (this.composing || event.isComposing || COMPOSITION_INPUTS.has(event.inputType)) return;
    // Si no se puede cancelar, el navegador lo aplica y `input` lo reconcilia.
    if (!event.cancelable) return;
    event.preventDefault();
    const type = event.inputType;
    const selection = this.readSelection() ?? this.selection();
    const target = this.targetRange(event);
    if (type === 'insertText') this.insert(target ?? selection, event.data ?? '');
    else if (type === 'insertReplacementText')
      this.insert(target ?? selection, plainToModel(this.transferText(event) ?? event.data ?? ''));
    else if (type === 'insertParagraph') this.splitLine(selection);
    else if (type === 'insertLineBreak') this.insert(selection, '\n');
    else if (type.startsWith('insertFrom'))
      this.insert(target ?? selection, plainToModel(this.transferText(event) ?? ''));
    else if (type === 'formatBold') this.toggleMark('bold');
    else if (type === 'formatItalic') this.toggleMark('italic');
    else if (type === 'formatUnderline') this.toggleMark('underline');
    else if (type === 'historyUndo') this.undo();
    else if (type === 'historyRedo') this.redo();
    else if (type.startsWith('delete')) this.deleteContent(type, selection, target);
    // El resto (formatos nativos, listas nativas) se ignora para no separar el DOM del modelo.
  }

  onInput(event: Event): void {
    if (this.composing || (event as InputEvent).isComposing) return;
    this.reconcile();
  }

  compositionStart(): void {
    this.composing = true;
    this.captureSelection();
  }

  compositionEnd(): void {
    this.composing = false;
    this.reconcile();
  }

  paste(event: ClipboardEvent): void {
    event.preventDefault();
    const range = this.readSelection() ?? this.selection();
    this.insert(range, plainToModel(event.clipboardData?.getData('text/plain') ?? ''));
  }

  keyDown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const mark = ({ b: 'bold', i: 'italic', u: 'underline' } as Record<string, Mark>)[key];
    if (mark) {
      event.preventDefault();
      this.toggleMark(mark);
    } else if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    } else if (key === 'y') {
      event.preventDefault();
      this.redo();
    } else if (key === 'k') {
      event.preventDefault();
      this.openLinkDialog();
    }
  }

  captureSelection(): void {
    const range = this.readSelection();
    if (!range) return;
    const previous = this.selection();
    if (previous.start !== range.start || previous.end !== range.end) this.lastEdit = null;
    this.selection.set(range);
    const pending = this.pending();
    // Durante la composición (IME) el cursor avanza solo: el formato pendiente se usa al reconciliar.
    if (!this.composing && pending && (range.start !== range.end || range.start !== pending.position))
      this.pending.set(null);
  }

  // ---------- Barra ----------

  toggleMark(mark: Mark): void {
    const range = this.currentRange();
    if (range.start === range.end) {
      const base = this.activeStyle();
      const marks = base.marks.includes(mark)
        ? base.marks.filter((item) => item !== mark)
        : MARKS.filter((item) => item === mark || base.marks.includes(item));
      this.pending.set({ position: range.start, style: { ...base, marks } });
      this.focusAt(range);
      return;
    }
    const on = !rangeHasMark(this.lines(), range, mark);
    this.commit(setMark(this.lines(), range, mark, on), range, 'format');
  }

  setBlockType(event: Event): void {
    const type = this.inputValue(event) as LineType;
    const range = this.toolbarRange();
    this.commit(setLineProps(this.lines(), range, { type }), range, 'structure');
  }

  setAlign(event: Event): void {
    const value = this.inputValue(event);
    const range = this.toolbarRange();
    this.commit(
      setLineProps(this.lines(), range, { align: value === 'left' ? null : value }),
      range,
      'structure',
    );
  }

  setFont(event: Event): void {
    const value = this.inputValue(event);
    const range = this.toolbarRange();
    this.commit(
      setLineProps(this.lines(), range, { font: value === 'sans' ? null : value }),
      range,
      'structure',
    );
  }

  setColor(event: Event): void {
    const value = this.inputValue(event);
    const color = value === 'ink' ? null : value;
    const range = this.toolbarRange();
    if (range.start === range.end) {
      this.pending.set({ position: range.start, style: { ...this.activeStyle(), color } });
      this.focusAt(range);
      return;
    }
    this.commit(
      mapRange(this.lines(), range, (run) => ({ ...run, color })),
      range,
      'format',
    );
  }

  openLinkDialog(): void {
    const range = this.currentRange();
    const extent = range.start === range.end ? linkExtent(this.lines(), range.start) : null;
    this.linkRange = extent ?? range;
    const href = extent
      ? styleOfRange(this.lines(), extent).href
      : styleOfRange(this.lines(), range).href;
    this.linkEditing.set(href != null);
    this.linkUrl.set(href ?? 'https://');
    this.linkError.set(null);
    this.linkOpen.set(true);
  }

  applyLink(event?: Event): void {
    event?.preventDefault();
    const href = this.linkUrl().trim();
    if (!isHttpsUrl(href)) {
      this.linkError.set('Enter a full address that starts with https://');
      return;
    }
    const range = this.linkRange ?? this.currentRange();
    this.linkOpen.set(false);
    this.linkRange = null;
    if (range.start === range.end) {
      // Sin selección se inserta la dirección como texto del link.
      const style = { ...styleAt(this.lines(), range.start), href };
      this.insert(range, href, style);
      return;
    }
    this.commit(
      mapRange(this.lines(), range, (run) => ({ ...run, href })),
      range,
      'format',
    );
  }

  removeLink(): void {
    const range = this.linkRange ?? this.currentRange();
    this.linkOpen.set(false);
    this.linkRange = null;
    this.commit(
      mapRange(this.lines(), range, (run) => ({ ...run, href: null })),
      range,
      'format',
    );
  }

  closeLinkDialog(): void {
    this.linkOpen.set(false);
    const range = this.linkRange;
    this.linkRange = null;
    if (range) this.focusAt(range);
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  // ---------- Ediciones ----------

  private insert(range: TextRange, text: string, forced?: RunStyle): void {
    const lines = this.lines();
    const ordered = order(range);
    const pending = this.pending();
    const style =
      forced ??
      (ordered.start === ordered.end && pending?.position === ordered.start
        ? pending.style
        : styleOfRange(lines, ordered));
    const available = MAX_CHARACTERS - (characterCount(lines) - charactersIn(lines, ordered));
    const clipped = clipCharacters(text, Math.max(0, available));
    if (!clipped && ordered.start === ordered.end) return;
    const caret = ordered.start + clipped.length;
    this.pending.set(null);
    this.commit(
      replaceRange(lines, ordered, clipped, style),
      { start: caret, end: caret },
      clipped === LINE_SEPARATOR ? 'structure' : 'typing',
    );
  }

  private splitLine(range: TextRange): void {
    const lines = this.lines();
    const ordered = order(range);
    const { line } = locate(lines, ordered.start);
    // Enter en un ítem vacío sale de la lista.
    if (ordered.start === ordered.end && isListType(lines[line].type) && !lines[line].runs.length) {
      this.commit(setLineProps(lines, ordered, { type: 'paragraph' }), ordered, 'structure');
      return;
    }
    this.insert(ordered, LINE_SEPARATOR, styleOfRange(lines, ordered));
  }

  private deleteContent(type: string, selection: TextRange, target: TextRange | null): void {
    const lines = this.lines();
    const ordered = order(selection);
    const backward = type.endsWith('Backward') || type === 'deleteByCut';
    if (ordered.start === ordered.end && type === 'deleteContentBackward') {
      const { line, offset } = locate(lines, ordered.start);
      // Retroceso al principio de un encabezado o ítem: primero vuelve a párrafo.
      if (offset === 0 && lines[line].type !== 'paragraph') {
        this.commit(setLineProps(lines, ordered, { type: 'paragraph' }), ordered, 'structure');
        return;
      }
    }
    let range = target && target.start !== target.end ? order(target) : ordered;
    if (range.start === range.end) {
      const text = plainText(lines);
      if (backward) {
        if (range.start === 0) return;
        const step = isLowSurrogate(text.charCodeAt(range.start - 1)) ? 2 : 1;
        range = { start: range.start - step, end: range.end };
      } else {
        if (range.end >= text.length) return;
        const step = isHighSurrogate(text.charCodeAt(range.end)) ? 2 : 1;
        range = { start: range.start, end: range.end + step };
      }
    }
    this.pending.set(null);
    this.commit(
      replaceRange(lines, range, '', EMPTY_STYLE),
      { start: range.start, end: range.start },
      'delete',
    );
  }

  /** Lleva al modelo lo que el navegador escribió por su cuenta. */
  private reconcile(): void {
    const surface = this.surface?.nativeElement;
    if (!surface) return;
    const domText = this.domLines()
      .map((line) => line.textContent ?? '')
      .join(LINE_SEPARATOR);
    const lines = this.lines();
    const caret = this.readSelection()?.end ?? null;
    const change = textDiff(plainText(lines), domText, caret);
    if (!change) return;
    const range = { start: change.start, end: change.end };
    // Un formato elegido con el cursor colapsado se aplica a lo que se compuso en ese punto.
    const pending = this.pending();
    const style =
      pending && change.start === pending.position && change.end === change.start
        ? pending.style
        : styleAt(lines, change.start);
    const available = MAX_CHARACTERS - (characterCount(lines) - charactersIn(lines, range));
    const text = clipCharacters(change.text, Math.max(0, available));
    const position = change.start + text.length;
    this.pending.set(null);
    this.commit(
      replaceRange(lines, range, text, style),
      { start: position, end: position },
      'typing',
      true,
    );
  }

  private undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push({ lines: this.lines(), selection: this.selection() });
    this.restore(previous);
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push({ lines: this.lines(), selection: this.selection() });
    this.restore(next);
  }

  private restore(snapshot: Snapshot): void {
    this.lines.set(snapshot.lines);
    this.lastEdit = null;
    this.render();
    this.select(snapshot.selection);
    this.emit();
  }

  private commit(next: Line[], selection: TextRange, kind: EditKind, force = false): void {
    if (!force && blockCount(next) > MAX_BLOCKS && blockCount(next) > blockCount(this.lines())) {
      this.render();
      this.select(this.selection());
      return;
    }
    if (!(kind === 'typing' && this.lastEdit === 'typing')) {
      this.undoStack.push({ lines: this.lines(), selection: this.selection() });
      if (this.undoStack.length > 100) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastEdit = kind;
    this.lines.set(next);
    this.render();
    const length = documentLength(next);
    this.select({ start: Math.min(selection.start, length), end: Math.min(selection.end, length) });
    this.emit();
  }

  private emit(): void {
    const document = toDocument(this.lines());
    this.lastEmitted = canonicalizeRichText(document);
    this.documentChange.emit(document);
  }

  private currentRange(): TextRange {
    const range = order(this.readSelection() ?? this.selection());
    this.selection.set(range);
    return range;
  }

  /** Los selects de la barra se llevan el foco: se devuelve a la superficie antes de pintar. */
  private toolbarRange(): TextRange {
    const range = this.currentRange();
    this.surface.nativeElement.focus({ preventScroll: true });
    return range;
  }

  // ---------- DOM ----------

  private render(): void {
    const surface = this.surface?.nativeElement;
    if (!surface) return;
    const renderer = this.renderer;
    while (surface.firstChild) renderer.removeChild(surface, surface.firstChild);
    let list: HTMLElement | null = null;
    let listType: LineType | null = null;
    this.lines().forEach((line, index) => {
      let parent: HTMLElement = surface;
      if (isListType(line.type)) {
        if (!list || listType !== line.type) {
          list = renderer.createElement(line.type === 'bulletList' ? 'ul' : 'ol') as HTMLElement;
          renderer.addClass(list, 'my-1');
          renderer.addClass(list, 'pl-6');
          renderer.addClass(list, line.type === 'bulletList' ? 'list-disc' : 'list-decimal');
          renderer.appendChild(surface, list);
          listType = line.type;
        }
        parent = list;
      } else {
        list = null;
        listType = null;
      }
      const tag = isListType(line.type)
        ? 'li'
        : line.type === 'heading2'
          ? 'h2'
          : line.type === 'heading3'
            ? 'h3'
            : 'p';
      const element = renderer.createElement(tag) as HTMLElement;
      renderer.setAttribute(element, 'data-line', String(index));
      for (const name of [
        ...LINE_CLASSES[line.type],
        ALIGN_CLASSES[line.align ?? ''],
        FONT_CLASSES[line.font ?? ''],
      ])
        if (name) renderer.addClass(element, name);
      this.renderRuns(element, line.runs);
      // Un `<br>` mantiene altura y cursor en líneas vacías o que terminan en salto suave.
      const text = line.runs.map((run) => run.text).join('');
      if (!text || text.endsWith('\n')) renderer.appendChild(element, renderer.createElement('br'));
      renderer.appendChild(parent, element);
    });
  }

  private renderRuns(element: HTMLElement, runs: readonly Run[]): void {
    const renderer = this.renderer;
    let link: HTMLElement | null = null;
    let linkHref: string | null = null;
    for (const run of runs) {
      let parent = element;
      if (run.href && isHttpsUrl(run.href)) {
        if (!link || linkHref !== run.href) {
          link = renderer.createElement('a') as HTMLElement;
          renderer.setAttribute(link, 'href', run.href);
          renderer.setAttribute(link, 'rel', 'noopener noreferrer');
          renderer.setAttribute(link, 'target', '_blank');
          renderer.addClass(link, 'text-brand-bold');
          renderer.addClass(link, 'underline');
          renderer.appendChild(element, link);
          linkHref = run.href;
        }
        parent = link;
      } else {
        link = null;
        linkHref = null;
      }
      const span = renderer.createElement('span') as HTMLElement;
      for (const mark of run.marks) renderer.addClass(span, MARK_CLASSES[mark]);
      const color = COLOR_CLASSES[run.color ?? ''];
      if (color) renderer.addClass(span, color);
      renderer.appendChild(span, renderer.createText(run.text));
      renderer.appendChild(parent, span);
    }
  }

  /** Líneas del DOM en orden: hijos de la superficie, y los ítems dentro de cada lista. */
  private domLines(): Node[] {
    const result: Node[] = [];
    for (const child of Array.from(this.surface.nativeElement.childNodes)) {
      if (child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL'))
        result.push(...Array.from(child.childNodes));
      else result.push(child);
    }
    return result;
  }

  private readSelection(): TextRange | null {
    const surface = this.surface?.nativeElement;
    const selection = surface ? window.getSelection() : null;
    if (!surface || !selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!surface.contains(range.startContainer) || !surface.contains(range.endContainer))
      return null;
    const start = this.pointToPosition(range.startContainer, range.startOffset);
    const end = this.pointToPosition(range.endContainer, range.endOffset);
    return start == null || end == null ? null : order({ start, end });
  }

  private targetRange(event: InputEvent): TextRange | null {
    const ranges = typeof event.getTargetRanges === 'function' ? event.getTargetRanges() : [];
    const first = ranges[0];
    if (!first) return null;
    const start = this.pointToPosition(first.startContainer, first.startOffset);
    const end = this.pointToPosition(first.endContainer, first.endOffset);
    return start == null || end == null ? null : order({ start, end });
  }

  private pointToPosition(node: Node, offset: number): number | null {
    const lines = this.domLines();
    let start = 0;
    for (const line of lines) {
      if (line === node || line.contains(node)) {
        if (line.nodeType === Node.TEXT_NODE) return start + offset;
        const range = document.createRange();
        range.selectNodeContents(line);
        range.setEnd(node, offset);
        return start + range.toString().length;
      }
      start += (line.textContent ?? '').length + 1;
    }
    // El punto cae en la superficie o en una lista: se ubica antes de la primera línea siguiente.
    const point = document.createRange();
    point.setStart(node, offset);
    point.collapse(true);
    start = 0;
    for (const line of lines) {
      const lineRange = document.createRange();
      lineRange.selectNodeContents(line);
      if (point.compareBoundaryPoints(Range.START_TO_START, lineRange) <= 0) return start;
      start += (line.textContent ?? '').length + 1;
    }
    return Math.max(0, start - 1);
  }

  private positionToPoint(position: number): { node: Node; offset: number } {
    const lines = this.domLines();
    let start = 0;
    for (const line of lines) {
      const length = (line.textContent ?? '').length;
      if (position <= start + length) return pointInLine(line, position - start);
      start += length + 1;
    }
    const last = lines.at(-1);
    return last
      ? pointInLine(last, (last.textContent ?? '').length)
      : { node: this.surface.nativeElement, offset: 0 };
  }

  private select(range: TextRange): void {
    this.selection.set(range);
    const selection = window.getSelection();
    if (!selection) return;
    const start = this.positionToPoint(range.start);
    const end = this.positionToPoint(range.end);
    const domRange = document.createRange();
    domRange.setStart(start.node, start.offset);
    domRange.setEnd(end.node, end.offset);
    selection.removeAllRanges();
    selection.addRange(domRange);
  }

  private focusAt(range: TextRange): void {
    this.surface.nativeElement.focus({ preventScroll: true });
    this.select(range);
  }

  private transferText(event: InputEvent): string | null {
    return event.dataTransfer?.getData('text/plain') ?? null;
  }
}

function pointInLine(line: Node, offset: number): { node: Node; offset: number } {
  if (line.nodeType === Node.TEXT_NODE) return { node: line, offset };
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let last: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (offset <= consumed + node.length) return { node, offset: offset - consumed };
    consumed += node.length;
    last = node;
  }
  return last ? { node: last, offset: last.length } : { node: line, offset: 0 };
}

/** Texto plano externo (pegado, arrastre): cada salto de línea abre una línea nueva. */
function plainToModel(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/\n/g, LINE_SEPARATOR);
}

function order(range: TextRange): TextRange {
  return range.start <= range.end ? range : { start: range.end, end: range.start };
}

/** Recorta a `limit` caracteres reales; los separadores de línea no cuentan. */
function clipCharacters(text: string, limit: number): string {
  let count = 0;
  let index = 0;
  for (; index < text.length; index++) {
    if (text[index] === LINE_SEPARATOR) continue;
    if (count === limit) break;
    count++;
  }
  return text.slice(0, index);
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
