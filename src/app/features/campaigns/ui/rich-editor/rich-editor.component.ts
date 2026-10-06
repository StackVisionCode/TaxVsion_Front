import { AfterViewChecked, Component, ElementRef, EventEmitter, Input, Output, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Editor del cuerpo de Email con DOS modos:
 *  - <b>Visual</b> (WYSIWYG, contenteditable + execCommand): negrita/itálica/listas/link/imagen.
 *  - <b>HTML</b> (textarea de código crudo): para PEGAR un HTML completo (plantilla propia) y usarlo
 *    verbatim — en visual el navegador escaparía el markup pegado.
 * Fuente de verdad = <c>html</c>. Binding de dos vías: [(html)]. Palette de variables en ambos modos.
 */
@Component({
  selector: 'app-rich-editor',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-xl border border-gray-200 overflow-hidden focus-within:border-blue-400">
      <!-- Mode switch -->
      <div class="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-2 py-1.5">
        <div class="flex rounded-lg bg-gray-200/70 p-0.5 text-xs">
          <button type="button" (click)="setMode('visual')" class="rounded-md px-2.5 py-1 font-semibold" [class]="mode() === 'visual' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'">Visual</button>
          <button type="button" (click)="setMode('html')" class="rounded-md px-2.5 py-1 font-semibold" [class]="mode() === 'html' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'">HTML</button>
        </div>
        @if (mode() === 'html') { <span class="text-[11px] text-gray-400">Paste your full HTML here — it's used as-is.</span> }
      </div>

      <!-- Visual toolbar -->
      @if (mode() === 'visual') {
        <div class="flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-2 py-1.5">
          <button type="button" title="Bold" (mousedown)="$event.preventDefault()" (click)="exec('bold')" class="h-8 w-8 rounded-lg text-sm font-bold text-gray-600 hover:bg-white">B</button>
          <button type="button" title="Italic" (mousedown)="$event.preventDefault()" (click)="exec('italic')" class="h-8 w-8 rounded-lg text-sm italic text-gray-600 hover:bg-white">I</button>
          <button type="button" title="Underline" (mousedown)="$event.preventDefault()" (click)="exec('underline')" class="h-8 w-8 rounded-lg text-sm underline text-gray-600 hover:bg-white">U</button>
          <span class="mx-1 h-5 w-px bg-gray-200"></span>
          <button type="button" title="Heading" (mousedown)="$event.preventDefault()" (click)="exec('formatBlock', 'H2')" class="h-8 px-2 rounded-lg text-xs font-bold text-gray-600 hover:bg-white">H</button>
          <button type="button" title="Bulleted list" (mousedown)="$event.preventDefault()" (click)="exec('insertUnorderedList')" class="h-8 w-8 rounded-lg text-gray-600 hover:bg-white">•</button>
          <button type="button" title="Numbered list" (mousedown)="$event.preventDefault()" (click)="exec('insertOrderedList')" class="h-8 w-8 rounded-lg text-xs text-gray-600 hover:bg-white">1.</button>
          <span class="mx-1 h-5 w-px bg-gray-200"></span>
          <button type="button" title="Insert link" (mousedown)="$event.preventDefault()" (click)="addLink()" class="h-8 w-8 rounded-lg text-sm text-gray-600 hover:bg-white">&#128279;</button>
          <button type="button" title="Insert image by URL" (mousedown)="$event.preventDefault()" (click)="addImageUrl()" class="h-8 px-2 rounded-lg text-xs text-gray-600 hover:bg-white">Img URL</button>
          <label title="Upload image" class="h-8 px-2 grid place-items-center rounded-lg text-xs text-gray-600 hover:bg-white cursor-pointer">
            Upload
            <input type="file" accept="image/*" class="hidden" (change)="onFile($event)" />
          </label>
          <span class="mx-1 h-5 w-px bg-gray-200"></span>
          <button type="button" title="Clear formatting" (mousedown)="$event.preventDefault()" (click)="exec('removeFormat')" class="h-8 px-2 rounded-lg text-xs text-gray-500 hover:bg-white">Clear</button>
        </div>
      }

      <!-- Variable palette (both modes) -->
      @if (variables.length) {
        <div class="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50/60 px-2 py-1.5">
          <span class="text-[11px] font-semibold text-gray-400 mr-1">Insert:</span>
          @for (v of variables; track v.token) {
            <button type="button" title="Insert {{ v.token }}" (mousedown)="$event.preventDefault()" (click)="insertToken(v.token)"
              class="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:border-blue-300 hover:text-blue-700">{{ v.label }}</button>
          }
        </div>
      }

      <!-- Visual editor -->
      @if (mode() === 'visual') {
        <div #editor
          class="min-h-[200px] max-h-[380px] overflow-auto px-3.5 py-3 text-sm outline-none"
          contenteditable="true"
          (input)="onInput()"
          (blur)="onInput()"
          [attr.data-ph]="placeholder"></div>
      } @else {
        <!-- HTML source -->
        <textarea #source
          class="block w-full min-h-[240px] max-h-[420px] px-3.5 py-3 font-mono text-xs leading-relaxed outline-none resize-y"
          spellcheck="false"
          [value]="html"
          (input)="onTextarea($event)"
          placeholder="<!DOCTYPE html> …"></textarea>
      }
    </div>
    @if (notice) { <p class="mt-1 text-[11px] text-amber-700">{{ notice }}</p> }
  `,
  styles: [
    `[contenteditable][data-ph]:empty:before { content: attr(data-ph); color: #9ca3af; }
     [contenteditable] img { max-width: 100%; height: auto; border-radius: 8px; }
     [contenteditable] a { color: #2563eb; text-decoration: underline; }
     [contenteditable] h2 { font-size: 1.1rem; font-weight: 600; margin: .4rem 0; }
     [contenteditable] ul { list-style: disc; padding-left: 1.25rem; }
     [contenteditable] ol { list-style: decimal; padding-left: 1.25rem; }`,
  ],
})
export class RichEditorComponent implements AfterViewChecked {
  @Input() placeholder = 'Write your message…';
  @Input() html = '';
  @Input() variables: { label: string; token: string }[] = [];
  @Output() htmlChange = new EventEmitter<string>();

  @ViewChild('editor') private editor?: ElementRef<HTMLDivElement>;
  @ViewChild('source') private source?: ElementRef<HTMLTextAreaElement>;

  /** Modo del editor. Si el html pegado parece un documento completo, arranca en HTML. */
  readonly mode = signal<'visual' | 'html'>('visual');
  private lastRendered: string | null = null;
  notice: string | null = null;

  setMode(mode: 'visual' | 'html'): void {
    this.mode.set(mode);
    this.lastRendered = null; // fuerza re-sync del contenteditable al volver a Visual
  }

  ngAfterViewChecked(): void {
    if (this.mode() !== 'visual') return;
    const el = this.editor?.nativeElement;
    if (!el) return;
    if (this.lastRendered === this.html) return;
    if (document.activeElement !== el) {
      el.innerHTML = this.html ?? '';
      this.lastRendered = this.html ?? '';
    }
  }

  private emit(value: string): void {
    this.html = value;
    this.htmlChange.emit(value);
  }

  onInput(): void {
    const el = this.editor?.nativeElement;
    if (!el) return;
    this.lastRendered = el.innerHTML;
    this.emit(el.innerHTML);
  }

  onTextarea(event: Event): void {
    this.emit((event.target as HTMLTextAreaElement).value);
  }

  exec(command: string, value?: string): void {
    this.editor?.nativeElement.focus();
    document.execCommand(command, false, value);
    this.onInput();
  }

  /** Inserta un token de variable en la posición del cursor (visual o textarea HTML). */
  insertToken(token: string): void {
    if (this.mode() === 'visual') {
      this.exec('insertText', token);
      return;
    }
    const ta = this.source?.nativeElement;
    if (!ta) return;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const next = ta.value.slice(0, start) + token + ta.value.slice(end);
    this.emit(next);
    // reposiciona el cursor tras el token
    queueMicrotask(() => {
      ta.focus();
      ta.setSelectionRange(start + token.length, start + token.length);
    });
  }

  addLink(): void {
    const url = window.prompt('Link URL (https://…)');
    if (url) this.exec('createLink', url);
  }

  addImageUrl(): void {
    const url = window.prompt('Image URL (https://…)');
    if (url) this.exec('insertImage', url);
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 300 * 1024) {
      this.notice = 'Image is too large (max ~300 KB embedded). For bigger images use a hosted image URL.';
      return;
    }
    this.notice = null;
    const reader = new FileReader();
    reader.onload = () => this.exec('insertImage', String(reader.result));
    reader.readAsDataURL(file);
  }
}
