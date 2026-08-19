import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface ComposeAttachment {
  name: string;
  size: number;
}

export interface FormatTool {
  key: string;
  label: string;
  /** Glifo de texto (B, I, …) o, si es null, se usa el ion-icon `icon`. */
  glyph: string | null;
  glyphClass?: string;
  icon?: string;
}

/** Botones de formato del toolbox (visuales sobre el textarea plano); se reusan en el reply inline del reading pane. */
export const FORMAT_TOOLS: FormatTool[] = [
  { key: 'bold', label: 'Bold', glyph: 'B', glyphClass: 'font-bold' },
  { key: 'italic', label: 'Italic', glyph: 'I', glyphClass: 'italic font-serif' },
  { key: 'underline', label: 'Underline', glyph: 'U', glyphClass: 'underline' },
  { key: 'strike', label: 'Strikethrough', glyph: 'S', glyphClass: 'line-through' },
  { key: 'bullet', label: 'Bulleted list', glyph: null, icon: 'list-outline' },
  { key: 'number', label: 'Numbered list', glyph: null, icon: 'reorder-four-outline' },
  { key: 'link', label: 'Insert link', glyph: null, icon: 'link-outline' },
  { key: 'emoji', label: 'Emoji', glyph: null, icon: 'happy-outline' },
];

/**
 * Editor de redacción del módulo Mail (estilo "Aether"). Ocupa el panel de
 * lectura (no es un modal): raíz `flex h-full flex-col` con header, campos
 * To/Cc/Subject, un toolbox (adjuntar archivos real + botones de formato
 * visuales), un textarea que llena el alto, chips de adjuntos y un footer
 * con Send/Discard. "Send" no envía de verdad: solo emite `sent` para que el
 * padre vuelva al panel de lectura y muestre un toast. Adjuntar usa un input
 * de archivos nativo real pero no sube nada — solo lista los nombres.
 */
@Component({
  selector: 'app-mail-compose',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mail-compose.component.html',
  styleUrl: './mail-compose.component.css',
})
export class MailComposeComponent {
  @Output() closed = new EventEmitter<void>();
  @Output() sent = new EventEmitter<void>();

  readonly formatTools = FORMAT_TOOLS;

  readonly to = signal('');
  readonly cc = signal('');
  readonly subject = signal('');
  readonly body = signal('');
  readonly attachments = signal<ComposeAttachment[]>([]);
  readonly activeFormats = signal<Set<string>>(new Set());

  readonly canSend = computed(() => this.to().trim().length > 0 && this.subject().trim().length > 0);

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) {
      return;
    }
    const picked: ComposeAttachment[] = Array.from(files).map(file => ({ name: file.name, size: file.size }));
    this.attachments.update(list => [...list, ...picked]);
    // Limpiar el input para permitir volver a elegir el mismo archivo.
    input.value = '';
  }

  removeAttachment(index: number): void {
    this.attachments.update(list => list.filter((_, i) => i !== index));
  }

  isFormatActive(key: string): boolean {
    return this.activeFormats().has(key);
  }

  toggleFormat(key: string): void {
    this.activeFormats.update(set => {
      const next = new Set(set);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  close(): void {
    this.resetDraft();
    this.closed.emit();
  }

  send(): void {
    if (!this.canSend()) {
      return;
    }
    this.resetDraft();
    this.sent.emit();
  }

  private resetDraft(): void {
    this.to.set('');
    this.cc.set('');
    this.subject.set('');
    this.body.set('');
    this.attachments.set([]);
    this.activeFormats.set(new Set());
  }
}
