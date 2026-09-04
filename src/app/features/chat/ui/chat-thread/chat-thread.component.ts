import {
  AfterViewChecked,
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VoiceNotePlayerComponent } from '../voice-note-player/voice-note-player.component';

export interface ChatMessage {
  id: string;
  senderId: 'me' | 'them';
  text?: string;
  attachment?: { name: string; size: string; fileId: string };
  /** Nota de voz: player en vez de tarjeta de archivo. */
  voiceNote?: { fileId: string; durationMs: number; waveform: number[] };
  time: string;
  dateGroup: string;
  isEdited: boolean;
  isDeleted: boolean;
  /** createdAtUtc crudo (ISO) — cursor para avanzar cotejos por fecha. */
  createdAtUtc: string;
  /** Cotejo de MI mensaje: 'sent' (1 gris) / 'delivered' (2 grises) / 'read' (2 azules). undefined si es del otro. */
  status?: 'sent' | 'delivered' | 'read';
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
  imports: [CommonModule, FormsModule, VoiceNotePlayerComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './chat-thread.component.html',
  // El host debe llenar su contenedor acotado (`flex-1 min-h-0`); por defecto un
  // componente Angular es `display:inline` con alto auto → el `h-full` interno colapsa,
  // el hilo nunca es scrolleable y crecía la página entera (no bajaba al último mensaje).
  host: { class: 'block h-full min-h-0' },
})
export class ChatThreadComponent implements AfterViewChecked, AfterViewInit, OnChanges, OnDestroy {
  @Input() messages: ChatMessage[] = [];
  @Input() otherName = '';
  @Input() otherAvatarColor = 'bg-brand-bold';
  /** id de la conversación activa — al cambiar, el hilo baja al fondo. */
  @Input() conversationId = '';
  /** displayName del otro escribiendo, o null — muestra el indicador "… is typing". */
  @Input() typingName: string | null = null;
  /** displayName del otro grabando una nota de voz, o null — muestra "… is recording a voice note". */
  @Input() recordingName: string | null = null;
  /** Hay más historial más viejo por cargar. */
  @Input() hasMoreHistory = false;
  /** Se está cargando una página más vieja. */
  @Input() loadingOlder = false;

  @Output() attachmentClicked = new EventEmitter<string>();
  @Output() loadOlder = new EventEmitter<void>();
  @Output() editSubmitted = new EventEmitter<MessageEdit>();
  @Output() deleteRequested = new EventEmitter<string>();

  @ViewChild('scrollContainer') private scrollContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('scrollInner') private scrollInner?: ElementRef<HTMLDivElement>;
  @ViewChild('editInput') private editInput?: ElementRef<HTMLInputElement>;

  readonly editingId = signal<string | null>(null);
  readonly editDraft = signal('');

  // Estado de scroll para "pegar al fondo" y preservar posición al anteponer historial.
  private isAtBottom = true;
  /**
   * "Pin al fondo" tras abrir un hilo: se mantiene pegado en CADA ciclo de vista mientras el alto
   * sigue asentando (notas de voz, adjuntos, avatares cargan async y crecen la lista un tick después,
   * cuando un solo scrollTop ya quedó corto → te quedabas arriba). Se suelta en cuanto el usuario sube.
   */
  private pinToBottom = false;
  private pendingScroll: 'bottom' | 'preserve' | null = null;
  private preserveFromHeight = 0;
  /**
   * Observa el crecimiento del contenido (avatares/notas de voz/adjuntos cargan async y NO siempre
   * disparan change-detection → `ngAfterViewChecked` no vuelve a correr y el pin no se re-afirmaba).
   * Mientras `pinToBottom` está activo, cada resize re-pega al fondo. Es el fix definitivo del auto-scroll.
   */
  private resizeObserver?: ResizeObserver;
  /** scrollTop del último evento — para distinguir scroll del USUARIO (sube) del programático (baja). */
  private lastScrollTop = 0;
  private prevConversationId = '';
  private prevFirstId: string | null = null;
  private prevLastId: string | null = null;
  private prevCount = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['messages'] || changes['conversationId']) {
      this.decideScroll();
    }
  }

  ngAfterViewInit(): void {
    const inner = this.scrollInner?.nativeElement;
    if (inner && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        // El contenido creció (mensajes pintados, avatar/nota de voz/adjunto async): si seguimos pegados
        // al fondo, re-pegar. Esto NO depende de un ciclo de Angular, así que sobrevive a las cargas async.
        if (this.pinToBottom) {
          this.scrollToBottom();
        }
      });
      this.resizeObserver.observe(inner);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  ngAfterViewChecked(): void {
    const el = this.scrollContainer?.nativeElement;
    if (!el || !this.pendingScroll) {
      return;
    }
    if (this.pendingScroll === 'bottom') {
      this.scrollToBottom();
    } else {
      // Antepusimos historial: mantené el mensaje que el usuario estaba mirando.
      el.scrollTop += el.scrollHeight - this.preserveFromHeight;
      this.lastScrollTop = el.scrollTop;
    }
    this.pendingScroll = null;
  }

  /** Baja al fondo y registra la posición para que `onScroll` no lo confunda con un scroll del usuario. */
  private scrollToBottom(): void {
    const el = this.scrollContainer?.nativeElement;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
    this.lastScrollTop = el.scrollTop;
    this.isAtBottom = true;
  }

  onScroll(): void {
    const el = this.scrollContainer?.nativeElement;
    if (!el) {
      return;
    }
    const top = el.scrollTop;
    this.isAtBottom = el.scrollHeight - top - el.clientHeight < BOTTOM_STICK_THRESHOLD;
    // Soltar el pin SOLO cuando el usuario sube de verdad (scrollTop bajó respecto al último) y ya no
    // está al fondo. El pin programático siempre BAJA (scrollTop sube), así que nunca se auto-suelta —
    // esto evita que el hilo se quede arriba mientras el contenido async todavía está creciendo.
    if (this.pinToBottom && top < this.lastScrollTop - 4 && !this.isAtBottom) {
      this.pinToBottom = false;
    }
    this.lastScrollTop = top;
    if (top < TOP_LOAD_THRESHOLD && this.hasMoreHistory && !this.loadingOlder) {
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
      this.isAtBottom = true; // entrar a un hilo arranca pegado al fondo (no arrastra el estado del anterior)
    } else if (count > this.prevCount) {
      const prepended = last === this.prevLastId && first !== this.prevFirstId;
      if (this.prevCount === 0) {
        // Primera población del hilo: al cambiar de conversación el store vacía la lista y los mensajes
        // llegan en un ngOnChanges POSTERIOR (con conversationId ya igual). Sin este caso caía al `else`
        // y dependía de `isAtBottom` heredado de la conversación anterior → se quedaba arriba.
        this.pendingScroll = 'bottom';
      } else if (prepended && this.prevCount > 1) {
        // Prepend REAL (loadOlder sobre un hilo ya cargado): preservá el mensaje que se estaba mirando.
        this.pendingScroll = 'preserve';
        this.preserveFromHeight = this.scrollContainer?.nativeElement.scrollHeight ?? 0; // alto ANTES de renderizar
      } else if (prepended) {
        // Carga INICIAL (el hilo tenía solo el preview de 1 mensaje y llega el historial completo):
        // al fondo. Sin esto se trataba como prepend y quedaba casi arriba (preserveFromHeight del preview).
        this.pendingScroll = 'bottom';
      } else {
        this.pendingScroll = this.isAtBottom ? 'bottom' : null; // mensaje nuevo: solo si estabas al fondo
      }
    } else {
      this.pendingScroll = null; // edit/delete: no muevas la vista
    }

    // El pin (que el ResizeObserver usa para re-pegar ante crecimiento async) sigue la intención: activo
    // cuando vamos al fondo, suelto al preservar historial (el usuario está leyendo hacia arriba).
    if (this.pendingScroll === 'bottom') {
      this.pinToBottom = true;
    } else if (this.pendingScroll === 'preserve') {
      this.pinToBottom = false;
    }

    this.prevConversationId = this.conversationId;
    this.prevFirstId = first;
    this.prevLastId = last;
    this.prevCount = count;
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
