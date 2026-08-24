import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  MessageSummary,
  ThreadSummary,
  avatarColorFor,
  formatFileSize,
  formatMailTime,
  initialsFor,
} from '../../data-access/mail.model';
import {
  MessageAttachmentsView,
  MessageBodyView,
  ReplyState,
} from '../../data-access/mail.store';

/**
 * Panel de lectura del módulo Mail: ya no muestra "un correo", sino la
 * CONVERSACIÓN completa (`GET /correspondence/threads/{id}/messages`), que
 * mezcla mensajes inbound y outbound en orden cronológico ascendente. Cada
 * mensaje es un acordeón: al expandirlo el store pide su cuerpo en vivo
 * (`/messages/{id}/body` para inbound, el draft enviado para outbound) y, si
 * corresponde, la metadata de adjuntos. Adjuntar/descargar y responder también
 * son reales — el reply usa el draft que crea `POST /messages/{id}/reply/draft`.
 *
 * Sigue dumb: recibe estado del store por @Input y emite intenciones. Sólo
 * importa tipos y helpers de presentación de data-access (funciones puras).
 */
@Component({
  selector: 'app-mail-reading-pane',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mail-reading-pane.component.html',
  styleUrl: './mail-reading-pane.component.css',
})
export class MailReadingPaneComponent implements OnChanges {
  @Input() thread: ThreadSummary | null = null;
  @Input() messages: MessageSummary[] = [];
  @Input() bodies: ReadonlyMap<string, MessageBodyView> = new Map();
  @Input() attachments: ReadonlyMap<string, MessageAttachmentsView> = new Map();
  @Input() expandedId: string | null = null;
  @Input() reply: ReplyState | null = null;
  @Input() loading = false;
  @Input() error: string | null = null;
  @Input() hasMore = false;
  @Input() archiving = false;
  /** Sin cuenta de buzón activa no se puede crear el draft de respuesta. */
  @Input() canReply = false;

  @Output() messageToggled = new EventEmitter<string>();
  @Output() bodyRetryRequested = new EventEmitter<string>();
  @Output() attachmentsRetryRequested = new EventEmitter<string>();
  @Output() attachmentDownloadRequested = new EventEmitter<{ messageId: string; attachmentId: string }>();
  @Output() replyStarted = new EventEmitter<string>();
  @Output() replyCancelled = new EventEmitter<void>();
  @Output() replySent = new EventEmitter<string>();
  @Output() archiveRequested = new EventEmitter<void>();
  @Output() loadMoreRequested = new EventEmitter<void>();
  @Output() retryRequested = new EventEmitter<void>();

  /** Texto del reply inline (el body viaja en el autosave justo antes del send). */
  readonly replyText = signal('');
  private lastReplyMessageId: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    // Cambiar de hilo descarta lo que se estuviera escribiendo.
    if (changes['thread']) {
      this.replyText.set('');
      this.lastReplyMessageId = null;
    }
    // El store recrea el objeto `reply` en cada paso (starting → listo → sending):
    // sólo se limpia el textarea cuando cambia el mensaje respondido o se cierra.
    if (changes['reply']) {
      const currentId = this.reply?.messageId ?? null;
      if (currentId !== this.lastReplyMessageId) {
        this.replyText.set('');
        this.lastReplyMessageId = currentId;
      }
    }
  }

  // ---------- Helpers de presentación ----------

  trackByMessageId(_index: number, message: MessageSummary): string {
    return message.messageId;
  }

  /** Inbound: remitente real. Outbound: es un draft nuestro ya enviado. */
  senderLabel(message: MessageSummary): string {
    if (message.direction === 'Outbound') {
      return 'You';
    }
    return message.fromDisplayName || message.from || 'Unknown sender';
  }

  /** Línea secundaria: dirección del remitente (inbound) o destinatarios (outbound). */
  addressLabel(message: MessageSummary): string {
    if (message.direction === 'Outbound') {
      const to = message.toAddresses ?? [];
      return to.length > 0 ? `To ${to.join(', ')}` : 'Sent';
    }
    return message.from ?? '';
  }

  initialsFor(message: MessageSummary): string {
    return initialsFor(this.senderLabel(message));
  }

  avatarColorFor(message: MessageSummary): string {
    return avatarColorFor(this.senderLabel(message));
  }

  timeFor(iso: string): string {
    return formatMailTime(iso);
  }

  fileSize(bytes: number): string {
    return formatFileSize(bytes);
  }

  bodyFor(messageId: string): MessageBodyView | null {
    return this.bodies.get(messageId) ?? null;
  }

  attachmentsFor(messageId: string): MessageAttachmentsView | null {
    return this.attachments.get(messageId) ?? null;
  }

  /** El backend marca BodyReady al servir el cuerpo: el punto sólo indica "nunca abierto". */
  isUnopened(message: MessageSummary): boolean {
    return message.direction === 'Inbound' && message.bodyStatus === 'BodyPending';
  }

  canReplyTo(message: MessageSummary): boolean {
    // Sólo se responde a inbound: el reply se ancla al mensaje entrante (RFC 5322).
    return this.canReply && message.direction === 'Inbound' && !!message.from;
  }

  isReplyingTo(messageId: string): boolean {
    return this.reply?.messageId === messageId;
  }

  canSendReply(): boolean {
    const reply = this.reply;
    return !!reply && !!reply.draftId && !reply.sending && this.replyText().trim().length > 0;
  }

  // ---------- Acciones ----------

  toggle(messageId: string): void {
    this.messageToggled.emit(messageId);
  }

  startReply(messageId: string, event: Event): void {
    event.stopPropagation();
    this.replyStarted.emit(messageId);
  }

  cancelReply(): void {
    this.replyText.set('');
    this.replyCancelled.emit();
  }

  sendReply(): void {
    if (!this.canSendReply()) {
      return;
    }
    this.replySent.emit(this.replyText().trim());
  }

  downloadAttachment(messageId: string, attachmentId: string): void {
    this.attachmentDownloadRequested.emit({ messageId, attachmentId });
  }

  archive(): void {
    if (this.archiving) {
      return;
    }
    this.archiveRequested.emit();
  }
}
