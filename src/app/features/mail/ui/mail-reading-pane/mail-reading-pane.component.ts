import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MailMessage } from '../mail-list/mail-list.component';
import { FORMAT_TOOLS } from '../mail-compose/mail-compose.component';

type ReplyMode = 'reply' | 'reply-all' | 'forward';

interface ReplyAttachment {
  name: string;
  size: number;
}

/**
 * Panel de lectura del módulo Mail (estilo "Aether"): cabecera con asunto,
 * remitente y botones de acción, cuerpo del correo, y un editor de
 * respuesta INLINE (no navega a otra pantalla): al tocar Reply/Reply
 * all/Forward (desde los botones del header o las píldoras de abajo) se
 * "levanta" ahí mismo el mismo toolbox del compose completo (adjuntar +
 * formato) con una animación de entrada. "Send" no envía de verdad: solo
 * emite `replied` para que el padre muestre el mismo toast que usa el
 * compose completo.
 */
@Component({
  selector: 'app-mail-reading-pane',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mail-reading-pane.component.html',
  styleUrl: './mail-reading-pane.component.css',
})
export class MailReadingPaneComponent implements OnChanges {
  @Input() message: MailMessage | null = null;
  @Output() starToggled = new EventEmitter<string>();
  @Output() replied = new EventEmitter<void>();
  @Output() archived = new EventEmitter<string>();
  @Output() deleted = new EventEmitter<string>();

  readonly formatTools = FORMAT_TOOLS;

  readonly replyMode = signal<ReplyMode | null>(null);
  readonly replyTo = signal('');
  readonly replyBody = signal('');
  readonly replyAttachments = signal<ReplyAttachment[]>([]);
  readonly activeFormats = signal<Set<string>>(new Set());

  readonly replyHeading = computed(() => {
    const name = this.message?.senderName ?? '';
    switch (this.replyMode()) {
      case 'reply':
        return `Replying to ${name}`;
      case 'reply-all':
        return `Reply all to ${name}`;
      case 'forward':
        return 'Forward this email';
      default:
        return '';
    }
  });

  readonly canSendReply = computed(() => {
    if (this.replyMode() === 'forward' && this.replyTo().trim().length === 0) {
      return false;
    }
    return this.replyBody().trim().length > 0;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['message']) {
      // Cambiar de correo descarta cualquier respuesta que se estuviera redactando.
      this.closeReply();
    }
  }

  toggleStar(): void {
    if (this.message) {
      this.starToggled.emit(this.message.id);
    }
  }

  archive(): void {
    if (this.message) {
      this.archived.emit(this.message.id);
    }
  }

  delete(): void {
    if (this.message) {
      this.deleted.emit(this.message.id);
    }
  }

  quickReply(text: string): void {
    this.replyMode.set('reply');
    this.replyBody.set(text);
    this.sendReply();
  }

  openReply(mode: ReplyMode): void {
    this.replyMode.set(mode);
  }

  closeReply(): void {
    this.replyMode.set(null);
    this.replyTo.set('');
    this.replyBody.set('');
    this.replyAttachments.set([]);
    this.activeFormats.set(new Set());
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) {
      return;
    }
    const picked: ReplyAttachment[] = Array.from(files).map(file => ({ name: file.name, size: file.size }));
    this.replyAttachments.update(list => [...list, ...picked]);
    input.value = '';
  }

  removeAttachment(index: number): void {
    this.replyAttachments.update(list => list.filter((_, i) => i !== index));
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

  sendReply(): void {
    if (!this.canSendReply()) {
      return;
    }
    this.closeReply();
    this.replied.emit();
  }
}
