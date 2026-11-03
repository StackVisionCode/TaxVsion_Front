import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { FormsModule } from '@angular/forms';
import {
  DeliveryNoticeCopy,
  DeliveryNoticeSummary,
  DeliveryTone,
  MessageSummary,
  RecipientDelivery,
  ThreadSummary,
  deliveryDetail,
  deliveryNoticeCopy,
  deliveryStatusPill,
  formatMailTime,
} from '../../data-access/mail.model';
import { StatusPillComponent, StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { avatarColorFor } from '@shared/utils/avatar.util';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { AvatarUrlService } from '@core/profile-photo/avatar-url';
import { CustomerSummary } from '@core/customers/customer-summary.model';
import { BytesPipe } from '@shared/pipes/bytes.pipe';
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
/** Botón de la tarjeta de aviso. */
export interface NoticeAction {
  id: 'fix' | 'edit' | 'resend' | 'view' | 'unblock';
  label: string;
  primary: boolean;
}

function statusToneOf(tone: DeliveryTone): StatusTone {
  switch (tone) {
    case 'green':
      return 'success';
    case 'red':
      return 'danger';
    case 'amber':
      return 'warning';
    default:
      return 'neutral';
  }
}

@Component({
  selector: 'app-mail-reading-pane',
  imports: [InfinityLoaderComponent, CommonModule, FormsModule, RouterLink, AvatarComponent, BytesPipe, StatusPillComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mail-reading-pane.component.html',
  styleUrl: './mail-reading-pane.component.css',
})
export class MailReadingPaneComponent implements OnChanges {
  private readonly avatarUrls = inject(AvatarUrlService);
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
  /** Cliente del buzón: si el remitente es su email, se muestra su foto (los externos quedan con iniciales). */
  @Input() customer: Pick<CustomerSummary, 'id' | 'displayName' | 'primaryEmail' | 'avatarFileId'> | null = null;
  /** Chip del cliente con enlace a su ficha (no en el perfil, donde ya se está en ella). */
  @Input() showCustomerLink = false;
  /** Reenviar desde un aviso exige buzón activo y permiso de redactar. */
  @Input() canResend = false;
  /** D-8: desbloquear una dirección suprimida (`postmaster.suppression.write`). */
  @Input() canUnblock = false;
  /** Aviso con una acción en curso (reenvío o desbloqueo). */
  @Input() noticeBusyId: string | null = null;

  @Output() messageToggled = new EventEmitter<string>();
  @Output() bodyRetryRequested = new EventEmitter<string>();
  @Output() attachmentsRetryRequested = new EventEmitter<string>();
  @Output() attachmentDownloadRequested = new EventEmitter<{ messageId: string; attachmentId: string }>();
  /** Abrir el adjunto en el visor global (lo monta la página). */
  @Output() attachmentPreviewRequested = new EventEmitter<{ messageId: string; attachmentId: string }>();
  @Output() replyStarted = new EventEmitter<string>();
  @Output() replyCancelled = new EventEmitter<void>();
  @Output() replySent = new EventEmitter<string>();
  @Output() archiveRequested = new EventEmitter<void>();
  @Output() unarchiveRequested = new EventEmitter<void>();
  @Output() deleteMessageRequested = new EventEmitter<string>();
  @Output() loadMoreRequested = new EventEmitter<void>();
  @Output() retryRequested = new EventEmitter<void>();
  /** Marca un mensaje inbound leído/no-leído. */
  @Output() messageReadStateToggled = new EventEmitter<{ messageId: string; isRead: boolean }>();
  /** Marca TODO el hilo leído (true) o no-leído (false). */
  @Output() threadReadStateToggled = new EventEmitter<boolean>();
  /** Tarjeta de aviso: reenviar (`fix` = corregir el destinatario), ver el original o desbloquear. */
  @Output() noticeResendRequested = new EventEmitter<{ notice: DeliveryNoticeSummary; fix: boolean }>();
  @Output() noticeOriginalRequested = new EventEmitter<DeliveryNoticeSummary>();
  @Output() noticeUnblockRequested = new EventEmitter<DeliveryNoticeSummary>();

  /** Texto del reply inline (el body viaja en el autosave justo antes del send). */
  readonly replyText = signal('');
  private lastReplyMessageId: string | null = null;
  @ViewChild('replyBox') private replyBox?: ElementRef<HTMLTextAreaElement>;

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
      // El editor queda listo (StartReply respondió): el foco va a escribir, con mouse o con `r`.
      const previous = changes['reply'].previousValue as ReplyState | null;
      if (previous?.starting && this.reply && !this.reply.starting && previous.messageId === this.reply.messageId) {
        setTimeout(() => this.replyBox?.nativeElement.focus());
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

  avatarColorFor(message: MessageSummary): string {
    const customer = this.senderCustomer(message);
    return avatarColorFor(customer ? customer.id : this.senderLabel(message));
  }

  /** Foto del remitente cuando es el cliente del buzón; null = iniciales. */
  senderAvatarUrl(message: MessageSummary): string | null {
    return this.avatarUrls.url(this.senderCustomer(message)?.avatarFileId);
  }

  /** El remitente entrante es el cliente identificado (mismo email que su ficha). */
  private senderCustomer(message: MessageSummary): Pick<CustomerSummary, 'id' | 'avatarFileId'> | null {
    const email = this.customer?.primaryEmail?.trim().toLowerCase();
    const from = message.from?.trim().toLowerCase();
    return message.direction !== 'Outbound' && !!email && email === from ? this.customer : null;
  }

  timeFor(iso: string): string {
    return formatMailTime(iso);
  }

  // ---------- Avisos y estado de entrega ----------

  isNotice(message: MessageSummary): boolean {
    return message.kind === 'DeliveryNotice' && !!message.deliveryNotice;
  }

  noticeCopy(notice: DeliveryNoticeSummary): DeliveryNoticeCopy {
    return deliveryNoticeCopy(notice);
  }

  /** Botones de la tarjeta según el motivo (la acción principal primero). */
  noticeActions(notice: DeliveryNoticeSummary): NoticeAction[] {
    const actions: NoticeAction[] = [];
    const primary = deliveryNoticeCopy(notice).primary;
    if (notice.outcome === 'NotDelivered' && this.canResend) {
      if (primary === 'fix') actions.push({ id: 'fix', label: 'Fix address and resend', primary: true });
      if (primary === 'edit') actions.push({ id: 'edit', label: 'Edit and resend', primary: true });
      if (primary === 'resend') actions.push({ id: 'resend', label: 'Resend', primary: true });
      if (primary === 'view') actions.push({ id: 'resend', label: 'Resend', primary: false });
    }
    if (notice.canViewOriginal) {
      actions.push({ id: 'view', label: 'View original notice', primary: primary === 'view' });
    }
    if (notice.suppressed && this.canUnblock) {
      actions.push({ id: 'unblock', label: 'Unblock', primary: false });
    }
    // La principal va primero aunque se haya agregado después (p. ej. "View original notice").
    return actions.sort((a, b) => Number(b.primary) - Number(a.primary));
  }

  runNoticeAction(action: NoticeAction, notice: DeliveryNoticeSummary): void {
    switch (action.id) {
      case 'fix':
        this.noticeResendRequested.emit({ notice, fix: true });
        break;
      case 'edit':
      case 'resend':
        this.noticeResendRequested.emit({ notice, fix: false });
        break;
      case 'view':
        this.noticeOriginalRequested.emit(notice);
        break;
      case 'unblock':
        this.noticeUnblockRequested.emit(notice);
        break;
    }
  }

  noticeIcon(tone: DeliveryTone): string {
    return tone === 'red' ? 'alert-circle-outline' : tone === 'amber' ? 'file-tray-outline' : 'time-outline';
  }

  noticeToneClasses(tone: DeliveryTone): string {
    switch (tone) {
      case 'red':
        return 'border-red-200 bg-red-50/60';
      case 'amber':
        return 'border-amber-200 bg-amber-50/60';
      default:
        return 'border-gray-200 bg-gray-50';
    }
  }

  noticeIconClasses(tone: DeliveryTone): string {
    switch (tone) {
      case 'red':
        return 'bg-red-100 text-red-600';
      case 'amber':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-gray-200 text-gray-500';
    }
  }

  /** Píldora del enviado: Delivered / Not delivered / Delayed (o "Sent" sin noticias). */
  deliveryPill(message: MessageSummary): { label: string; tone: StatusTone; toneClass: string; title: string } {
    const pill = deliveryStatusPill(message.deliveryStatus);
    return {
      label: pill.label,
      tone: statusToneOf(pill.tone),
      toneClass: pill.tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-700' : '',
      title: deliveryDetail(message.deliveries) || pill.label,
    };
  }

  /** Destinatarios con noticias de entrega (para el detalle al expandir). */
  deliveriesWithStatus(message: MessageSummary): RecipientDelivery[] {
    return (message.deliveries ?? []).filter(item => item.status !== null);
  }

  deliveryLabel(item: RecipientDelivery): string {
    return deliveryStatusPill(item.status).label;
  }

  deliveryTone(item: RecipientDelivery): string {
    switch (item.status) {
      case 'Delivered':
        return 'text-emerald-700';
      case 'NotDelivered':
        return 'text-red-700';
      case 'Delayed':
        return 'text-amber-700';
      default:
        return 'text-gray-500';
    }
  }

  bodyFor(messageId: string): MessageBodyView | null {
    return this.bodies.get(messageId) ?? null;
  }

  attachmentsFor(messageId: string): MessageAttachmentsView | null {
    return this.attachments.get(messageId) ?? null;
  }

  /** Correo entrante sin leer (estado compartido por el tenant) — pinta el punto y la negrita. */
  isUnread(message: MessageSummary): boolean {
    return message.direction === 'Inbound' && !message.isRead;
  }

  /** El hilo tiene correos sin leer (para el botón "Mark all as read/unread" del header). */
  threadHasUnread(): boolean {
    return (this.thread?.unreadCount ?? 0) > 0;
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

  previewAttachment(messageId: string, attachmentId: string): void {
    this.attachmentPreviewRequested.emit({ messageId, attachmentId });
  }

  archive(): void {
    if (this.archiving) {
      return;
    }
    this.archiveRequested.emit();
  }

  toggleMessageRead(message: MessageSummary): void {
    if (message.direction !== 'Inbound') {
      return;
    }
    this.messageReadStateToggled.emit({ messageId: message.messageId, isRead: !message.isRead });
  }

  markThreadRead(isRead: boolean): void {
    this.threadReadStateToggled.emit(isRead);
  }
}
