import {
  AfterViewChecked,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface ChatMessage {
  id: string;
  senderId: 'me' | 'them';
  text?: string;
  attachment?: { name: string; size: string; fileId: string };
  time: string;
  dateGroup: string;
  isEdited: boolean;
  isDeleted: boolean;
}

export interface MessageEdit {
  id: string;
  text: string;
}

/** A qué distancia del borde consideramos "pegado" arriba/abajo (px). */
const TOP_LOAD_THRESHOLD = 60;
const BOTTOM_STICK_THRESHOLD = 80;

/**
 * Hilo de mensajes del Chat de equipo. Burbujas negras a la derecha ("mí"),
 * blancas con avatar para el otro. Adjuntos, separadores de fecha, indicador de
 * "typing", marca "Seen", editar/borrar mis mensajes en línea, e historial
 * paginado hacia arriba (scrollback) preservando la posición de lectura.
 */
@Component({
  selector: 'app-chat-thread',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './chat-thread.component.html',
})
export class ChatThreadComponent implements AfterViewChecked, OnChanges {
  @Input() messages: ChatMessage[] = [];
  @Input() otherName = '';
  @Input() otherAvatarColor = 'bg-brand-bold';
  /** id de la conversación activa — al cambiar, el hilo baja al fondo. */
  @Input() conversationId = '';
  /** displayName del otro escribiendo, o null — muestra el indicador "… is typing". */
  @Input() typingName: string | null = null;
  /** id del último mensaje que el otro leyó — ubica el marcador "Seen". */
  @Input() readUpToMessageId: string | null = null;
  /** Hay más historial más viejo por cargar. */
  @Input() hasMoreHistory = false;
  /** Se está cargando una página más vieja. */
  @Input() loadingOlder = false;

  @Output() attachmentClicked = new EventEmitter<string>();
  @Output() loadOlder = new EventEmitter<void>();
  @Output() editSubmitted = new EventEmitter<MessageEdit>();
  @Output() deleteRequested = new EventEmitter<string>();

  @ViewChild('scrollContainer') private scrollContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('editInput') private editInput?: ElementRef<HTMLInputElement>;

  readonly editingId = signal<string | null>(null);
  readonly editDraft = signal('');

  /** id de mi último mensaje propio que ya fue leído — bajo él va el "Seen". */
  seenAfterMessageId: string | null = null;

  // Estado de scroll para "pegar al fondo" y preservar posición al anteponer historial.
  private isAtBottom = true;
  private pendingScroll: 'bottom' | 'preserve' | null = null;
  private preserveFromHeight = 0;
  private prevConversationId = '';
  private prevFirstId: string | null = null;
  private prevLastId: string | null = null;
  private prevCount = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['messages'] || changes['conversationId']) {
      this.decideScroll();
    }
    if (changes['messages'] || changes['readUpToMessageId']) {
      this.seenAfterMessageId = this.computeSeenAfterMessageId();
    }
  }

  ngAfterViewChecked(): void {
    const el = this.scrollContainer?.nativeElement;
    if (!el || !this.pendingScroll) {
      return;
    }
    if (this.pendingScroll === 'bottom') {
      el.scrollTop = el.scrollHeight;
    } else {
      // Antepusimos historial: mantené el mensaje que el usuario estaba mirando.
      el.scrollTop += el.scrollHeight - this.preserveFromHeight;
    }
    this.pendingScroll = null;
  }

  onScroll(): void {
    const el = this.scrollContainer?.nativeElement;
    if (!el) {
      return;
    }
    this.isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_STICK_THRESHOLD;
    if (el.scrollTop < TOP_LOAD_THRESHOLD && this.hasMoreHistory && !this.loadingOlder) {
      this.loadOlder.emit();
    }
  }

  /** Decide el ajuste de scroll según cómo cambió la lista (fondo / preservar / nada). */
  private decideScroll(): void {
    const first = this.messages[0]?.id ?? null;
    const last = this.messages[this.messages.length - 1]?.id ?? null;
    const count = this.messages.length;

    if (this.conversationId !== this.prevConversationId) {
      this.pendingScroll = 'bottom'; // conversación nueva: al fondo
    } else if (count > this.prevCount) {
      const prepended = last === this.prevLastId && first !== this.prevFirstId;
      if (prepended) {
        this.pendingScroll = 'preserve';
        this.preserveFromHeight = this.scrollContainer?.nativeElement.scrollHeight ?? 0; // alto ANTES de renderizar
      } else {
        this.pendingScroll = this.isAtBottom ? 'bottom' : null; // mensaje nuevo: solo si estabas al fondo
      }
    } else {
      this.pendingScroll = null; // edit/delete: no muevas la vista
    }

    this.prevConversationId = this.conversationId;
    this.prevFirstId = first;
    this.prevLastId = last;
    this.prevCount = count;
  }

  /** El "Seen" va bajo mi último mensaje propio situado en o antes del readUpToMessageId. */
  private computeSeenAfterMessageId(): string | null {
    if (!this.readUpToMessageId) {
      return null;
    }
    const readIdx = this.messages.findIndex(m => m.id === this.readUpToMessageId);
    if (readIdx < 0) {
      return null;
    }
    for (let i = Math.min(readIdx, this.messages.length - 1); i >= 0; i--) {
      if (this.messages[i].senderId === 'me') {
        return this.messages[i].id;
      }
    }
    return null;
  }

  canEdit(message: ChatMessage): boolean {
    return message.senderId === 'me' && !message.isDeleted && !!message.text && !message.attachment;
  }

  canDelete(message: ChatMessage): boolean {
    return message.senderId === 'me' && !message.isDeleted;
  }

  startEdit(message: ChatMessage): void {
    this.editingId.set(message.id);
    this.editDraft.set(message.text ?? '');
    setTimeout(() => this.editInput?.nativeElement.focus());
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editDraft.set('');
  }

  saveEdit(message: ChatMessage): void {
    const text = this.editDraft().trim();
    if (!text || text === message.text) {
      this.cancelEdit();
      return;
    }
    this.editSubmitted.emit({ id: message.id, text });
    this.cancelEdit();
  }

  initials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  }

  showDateSeparator(index: number): boolean {
    if (index === 0) {
      return true;
    }
    return this.messages[index - 1].dateGroup !== this.messages[index].dateGroup;
  }
}
