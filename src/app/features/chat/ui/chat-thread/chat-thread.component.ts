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
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { FormsModule } from '@angular/forms';
import { VoiceNotePlayerComponent } from '../voice-note-player/voice-note-player.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { AvatarUrlPipe } from '@core/profile-photo/avatar-url.pipe';
import { ChatParticipant, VoiceNoteTranscriptState } from '../../data-access/chat.model';

export interface ChatMessage {
  id: string;
  senderId: 'me' | 'them';
  /** Evento del sistema (p.ej. "Missed call", "Call ended 2:34") — se pinta centrado, no como burbuja. */
  isSystem?: boolean;
  text?: string;
  attachment?: { name: string; size: string; fileId: string };
  /** Nota de voz: player en vez de tarjeta de archivo. F7: + transcript (estado y texto). */
  voiceNote?: {
    fileId: string;
    durationMs: number;
    waveform: number[];
    transcriptState?: VoiceNoteTranscriptState | null;
    transcriptText?: string | null;
  };
  /** F7 — mensaje System con archivo (transcript de una llamada): enlace "View transcript". */
  systemAttachmentFileId?: string;
  time: string;
  dateGroup: string;
  isEdited: boolean;
  isDeleted: boolean;
  /** createdAtUtc crudo (ISO) — cursor para avanzar cotejos por fecha. */
  createdAtUtc: string;
  /** userId real del remitente (los ajenos): semilla del color y llave de su foto entre los participantes. */
  senderUserId?: string;
  senderName?: string;
  /** Foto que trajo el historial; respaldo si el remitente ya no está entre los participantes. */
  senderAvatarFileId?: string | null;
  /**
   * Cotejo de MI mensaje: 'sending' (reloj, aún sin ack) / 'failed' (no se envió, se puede reintentar) /
   * 'sent' (1 gris) / 'delivered' (2 grises) / 'read' (2 azules). undefined si es del otro.
   */
  status?: 'sending' | 'failed' | 'sent' | 'delivered' | 'read';
  /**
   * Clave estable del nodo en el DOM. Un mensaje optimista nace con un id temporal y al llegar el ack
   * pasa a tener el id real: `renderKey` no cambia, así la burbuja no se destruye y recrea (parpadeo).
   */
  renderKey?: string;
}

export interface MessageEdit {
  id: string;
  text: string;
}

/** A qué distancia del borde consideramos "pegado" arriba/abajo (px). */
const TOP_LOAD_THRESHOLD = 60;
const BOTTOM_STICK_THRESHOLD = 80;
/** Transcript de nota de voz más largo que esto se colapsa a 3 líneas con "Show more". */
const TRANSCRIPT_COLLAPSE_CHARS = 160;
const TRANSCRIPT_COLLAPSE_LINES = 3;
/** Cuánto dura el resaltado de un mensaje al saltar desde la búsqueda. */
const HIGHLIGHT_MS = 2500;

/**
 * Hilo de mensajes del Chat de equipo. Burbujas negras a la derecha ("mí"),
 * blancas con avatar para el otro. Adjuntos, separadores de fecha, indicador de
 * "typing", marca "Seen", editar/borrar mis mensajes en línea, e historial
 * paginado hacia arriba (scrollback) preservando la posición de lectura.
 */
@Component({
  selector: 'app-chat-thread',
  imports: [CommonModule, FormsModule, VoiceNotePlayerComponent, AvatarComponent, AvatarUrlPipe, InfinityLoaderComponent],
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
  /** Participantes con su foto vigente (se actualiza en vivo con `user.profile.changed`). */
  @Input() participants: ChatParticipant[] = [];
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
  /** Reintentar un mensaje propio que quedó "failed" (id temporal). */
  @Output() retryRequested = new EventEmitter<string>();
  /** F7 — "View transcript" de un mensaje System (fileId del transcript de la llamada). */
  @Output() transcriptRequested = new EventEmitter<string>();
  /** F7 — botón "Transcribe" / "Try again" de una nota de voz (id del mensaje). */
  @Output() voiceTranscriptRequested = new EventEmitter<string>();

  @ViewChild('scrollContainer') private scrollContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('scrollInner') private scrollInner?: ElementRef<HTMLDivElement>;
  @ViewChild('editInput') private editInput?: ElementRef<HTMLInputElement>;

  readonly editingId = signal<string | null>(null);
  readonly editDraft = signal('');
  /** F7 — transcripts de notas de voz desplegados ("Show more"). */
  readonly expandedTranscripts = signal<ReadonlySet<string>>(new Set());
  /** F7 — mensaje resaltado tras saltar desde la búsqueda. */
  readonly highlightedId = signal<string | null>(null);
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Llegaron mensajes del otro mientras el usuario leía más arriba: en vez de arrancarle la vista
   * al fondo se muestra la píldora "New messages ↓" (patrón de Slack/WhatsApp/Discord).
   */
  readonly unseenCount = signal(0);

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
    clearTimeout(this.highlightTimer);
  }

  /**
   * F7 — salta a un mensaje cargado (resultado de la búsqueda) y lo resalta un momento. false = ese
   * mensaje no está cargado en el hilo (la búsqueda solo lo resalta en su lista).
   */
  scrollToMessage(messageId: string): boolean {
    const container = this.scrollContainer?.nativeElement;
    const target = container
      ? [...container.querySelectorAll<HTMLElement>('[data-message-id]')].find(el => el.dataset['messageId'] === messageId)
      : undefined;
    if (!target) {
      return false;
    }
    this.pinToBottom = false; // el usuario va a leer arriba: no re-pegar al fondo
    target.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    this.highlightedId.set(messageId);
    clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => this.highlightedId.set(null), HIGHLIGHT_MS);
    return true;
  }

  /** El transcript no cabe en 3 líneas (aprox.): se ofrece "Show more". */
  isLongTranscript(text: string | null | undefined): boolean {
    return !!text && (text.length > TRANSCRIPT_COLLAPSE_CHARS || text.split('\n').length > TRANSCRIPT_COLLAPSE_LINES);
  }

  isTranscriptExpanded(messageId: string): boolean {
    return this.expandedTranscripts().has(messageId);
  }

  toggleTranscript(messageId: string): void {
    this.expandedTranscripts.update(current => {
      const next = new Set(current);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
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
    this.unseenCount.set(0);
  }

  /** Píldora "New messages": baja al último mensaje y vuelve a pegarse al fondo. */
  jumpToLatest(): void {
    const el = this.scrollContainer?.nativeElement;
    if (!el) {
      return;
    }
    this.pinToBottom = true;
    el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    this.unseenCount.set(0);
  }

  /** Identidad estable por id: sin esto cada evento del socket recreaba TODAS las burbujas (parpadeo). */
  trackMessage(_: number, message: ChatMessage): string {
    return message.renderKey ?? message.id;
  }

  onScroll(): void {
    const el = this.scrollContainer?.nativeElement;
    if (!el) {
      return;
    }
    const top = el.scrollTop;
    this.isAtBottom = el.scrollHeight - top - el.clientHeight < BOTTOM_STICK_THRESHOLD;
    if (this.isAtBottom && this.unseenCount() > 0) {
      this.unseenCount.set(0);
    }
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
      this.unseenCount.set(0);
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
      } else if (this.messages[count - 1]?.senderId === 'me') {
        // Lo mandé yo: SIEMPRE al fondo, aunque estuviera leyendo más arriba (lo esperado en cualquier chat).
        this.pendingScroll = 'bottom';
      } else if (this.isAtBottom) {
        this.pendingScroll = 'bottom'; // mensaje del otro y estaba al fondo: lo sigo
      } else {
        // Mensaje del otro mientras leo más arriba: no muevo la vista, aviso con la píldora.
        this.pendingScroll = null;
        this.unseenCount.update(n => n + (count - this.prevCount));
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

  /** Un mensaje optimista (aún sin id real del servidor) no se puede editar ni borrar. */
  private isPending(message: ChatMessage): boolean {
    return message.status === 'sending' || message.status === 'failed';
  }

  canEdit(message: ChatMessage): boolean {
    return message.senderId === 'me' && !message.isDeleted && !!message.text && !message.attachment && !this.isPending(message);
  }

  canDelete(message: ChatMessage): boolean {
    return message.senderId === 'me' && !message.isDeleted && !this.isPending(message);
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


  /** Mismo autor que el mensaje anterior (y mismo día): se agrupan sin repetir el avatar. */
  isContinuation(index: number): boolean {
    const prev = this.messages[index - 1];
    const current = this.messages[index];
    return (
      !!prev &&
      !prev.isSystem &&
      !current.isSystem &&
      prev.senderId === current.senderId &&
      // En grupo, dos ajenos seguidos de personas distintas no se agrupan (cada uno con su foto).
      (prev.senderUserId ?? null) === (current.senderUserId ?? null) &&
      prev.dateGroup === current.dateGroup
    );
  }

  /** Foto del remitente: la vigente entre los participantes; si no se conoce, la que trajo el historial. */
  senderAvatarFileId(message: ChatMessage): string | null {
    const participant = message.senderUserId
      ? this.participants.find(p => p.userId === message.senderUserId)
      : undefined;
    if (participant && participant.avatarFileId !== undefined) {
      return participant.avatarFileId ?? null;
    }
    return message.senderAvatarFileId ?? null;
  }

  showDateSeparator(index: number): boolean {
    if (index === 0) {
      return true;
    }
    return this.messages[index - 1].dateGroup !== this.messages[index].dateGroup;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
