import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, firstValueFrom, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthService } from '@core/auth/auth.service';
import { toApiError } from '@core/models/api-error.model';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { FileResponse, formatBytes } from '@core/cloud-storage/cloud-storage.model';
import { ChatConversation } from '../ui/chat-conversation-list/chat-conversation-list.component';
import { ChatMessage } from '../ui/chat-thread/chat-thread.component';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatDirectoryService } from './chat-directory.service';
import { ChatService } from './chat.service';
import { ChatSocketService } from './chat-socket.service';
import { ConversationSummary, CustomerDirectoryEntry, EmployeeDirectoryEntry, MessageDto, TypingDto } from './chat.model';
import { parseUtcDate } from '../../../shared/utils/utc-date.util';

const AVATAR_PALETTE = ['bg-brand-bold', 'bg-sky-700', 'bg-brand-ink', 'bg-slate-500', 'bg-indigo-400'];

/** Corta el "typing" saliente tras esta inactividad (además el server auto-expira). */
const TYPING_IDLE_MS = 3000;
/** Red de seguridad: si no llega `typing.stopped`, se limpia el indicador entrante igual. */
const TYPING_EXPIRY_MS = 6000;

function avatarColorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function formatTime(iso: string): string {
  return parseUtcDate(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDateGroup(iso: string): string {
  const date = parseUtcDate(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) {
    return 'Today';
  }
  if (sameDay(date, yesterday)) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Store de Chat de equipo (Communication, `/communication` vía Gateway). El
 * listado y el historial vienen de HTTP; crear conversación, enviar/editar/
 * borrar mensaje, typing y presencia son Socket.IO-only en el backend real
 * (ver ChatSocketService). Nueva conversación (directa o grupo, según
 * `canCreateGroups`) y adjuntos reales (CloudStorage, `@core/cloud-storage`)
 * ya están conectados; siguen afuera: reacciones, editar/borrar desde la UI,
 * y video-llamadas.
 */
@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly chatService = inject(ChatService);
  private readonly socket = inject(ChatSocketService);
  private readonly auth = inject(AuthService);
  private readonly directory = inject(ChatDirectoryService);
  private readonly attachments = inject(ChatAttachmentsService);
  private readonly cloudStorage = inject(CloudStorageUploadService);

  private readonly _conversations = signal<ChatConversation[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _activeConversationId = signal<string | null>(null);

  readonly conversations = this._conversations.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly activeConversationId = this._activeConversationId.asReadonly();
  readonly connected = this.socket.connected;
  /** No-leídos totales de todas las conversaciones — para el badge del sidebar. */
  readonly totalUnread = computed(() => this._conversations().reduce((sum, c) => sum + c.unread, 0));

  /** userId del otro participante por conversación 1:1 — para reflejar chat.presence.changed. */
  private readonly otherParticipantByConversation = new Map<string, string>();
  /** createdAtUtc del último mensaje conocido por conversación — cursor `since` del backfill al reconectar. */
  private readonly lastMessageAtByConversation = new Map<string, string>();
  private socketWired = false;

  // ---------- Historial (scrollback) ----------
  /** Cursor `before` de la próxima página más vieja por conversación (null = no hay más). */
  private readonly historyCursorByConversation = new Map<string, string | null>();
  private readonly _loadingOlder = signal(false);
  readonly loadingOlder = this._loadingOlder.asReadonly();

  /** Error de la última acción de mensaje (edit/delete) para mostrar al usuario. */
  private readonly _messageActionError = signal<string | null>(null);
  readonly messageActionError = this._messageActionError.asReadonly();

  // ---------- Typing ----------
  /** Conversación en la que YO estoy escribiendo ahora (para no re-emitir typing.start). */
  private typingActiveConversationId: string | null = null;
  private typingStopTimer: ReturnType<typeof setTimeout> | undefined;
  /** Expiración por (conversación:usuario) del typing ENTRANTE — clave `${convId}:${userId}`. */
  private readonly typingExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ---------- Nueva conversación ----------
  private readonly _employeeResults = signal<EmployeeDirectoryEntry[]>([]);
  private readonly _customerResults = signal<CustomerDirectoryEntry[]>([]);
  private readonly _employeeSearchLoading = signal(false);
  private readonly _employeeSearchError = signal<string | null>(null);
  private readonly _newConversationError = signal<string | null>(null);
  private readonly _creatingConversation = signal(false);

  readonly employeeResults = this._employeeResults.asReadonly();
  readonly customerResults = this._customerResults.asReadonly();
  readonly employeeSearchLoading = this._employeeSearchLoading.asReadonly();
  readonly employeeSearchError = this._employeeSearchError.asReadonly();
  readonly newConversationError = this._newConversationError.asReadonly();
  readonly creatingConversation = this._creatingConversation.asReadonly();

  /** communication.group.create solo lo tiene Tenant Admin por defecto — ver MeResponse.permissions. */
  readonly canCreateGroups = computed(
    () => this.auth.currentUser()?.permissions.includes('communication.group.create') ?? false,
  );

  /** Permiso para iniciar llamadas de audio 1:1 (el backend exige communication.call.start en initiate). */
  readonly canStartAudioCall = computed(
    () => this.auth.currentUser()?.permissions.includes('communication.call.start') ?? false,
  );

  /** Permiso para iniciar videollamadas 1:1 (el backend exige communication.videocall.start en initiate con kind Video). */
  readonly canStartVideoCall = computed(
    () => this.auth.currentUser()?.permissions.includes('communication.videocall.start') ?? false,
  );

  // ---------- Adjuntos ----------
  private readonly _uploadingAttachment = signal(false);
  readonly uploadingAttachment = this._uploadingAttachment.asReadonly();

  /** Metadata resuelta perezosamente para adjuntos ajenos/históricos (el MessageDto solo trae el fileId). */
  private readonly fileMetaCache = new Map<string, FileResponse>();
  private readonly pendingFileMetaLookups = new Set<string>();

  /**
   * Abre una conversación por id reutilizando todo el motor de chat. Si ya está en la
   * lista la selecciona; si no (p. ej. deep-link a un ticket de Support recién creado),
   * recarga la lista pidiéndole que quede seleccionada esa. Lo usa el deep-link de Support.
   */
  focusConversation(id: string): void {
    if (this._conversations().some(c => c.id === id)) {
      this.selectConversation(id);
    } else {
      this.load(id);
    }
  }

  /**
   * Prepara el chat lo justo para el badge de no-leídos del sidebar SIN abrir el módulo:
   * conecta el socket, cablea los eventos (para que los mensajes nuevos suban el conteo en
   * vivo) y carga la lista de conversaciones (con sus no-leídos) — sin previews ni seleccionar
   * ni marcar leído nada. Lo llama el shell al entrar.
   */
  primeForBadge(): void {
    this.socket.connect();
    this.wireSocketEventsOnce();
    if (this._conversations().length === 0) {
      this.refreshConversationList();
    }
  }

  load(preferConversationId?: string): void {
    this.socket.connect();
    this.wireSocketEventsOnce();

    this._loading.set(true);
    this._error.set(null);
    this.chatService.listConversations({ size: 50 }).subscribe({
      next: result => {
        this.otherParticipantByConversation.clear();
        const currentUserId = this.auth.currentUser()?.id ?? null;
        result.items.forEach(summary => {
          const other = summary.participants.find(p => p.userId !== currentUserId);
          if (other) {
            this.otherParticipantByConversation.set(summary.id, other.userId);
          }
        });

        // Preview: 1 mensaje por conversación (el backend no incluye snippet del último mensaje en la lista).
        const previews: Observable<ChatConversation>[] = result.items.map(summary =>
          this.chatService.getMessages(summary.id, { take: 1 }).pipe(
            map(page => this.toConversation(summary, currentUserId, page.items)),
            catchError(() => of(this.toConversation(summary, currentUserId, []))),
          ),
        );
        (previews.length ? forkJoin(previews) : of([] as ChatConversation[])).subscribe(conversations => {
          this._conversations.set(conversations);
          this._loading.set(false);
          // Deep-link: si pidieron una conversación puntual (Support), abrí esa; si no, la primera.
          if (preferConversationId) {
            if (!conversations.some(c => c.id === preferConversationId)) {
              // No vino en esta página (ticket viejo): la abrimos igual — es válida para el usuario.
              this.ensureOptimisticConversation(preferConversationId, 'Conversation');
            }
            this.selectConversation(preferConversationId);
          } else if (!this._activeConversationId() && conversations.length) {
            this.selectConversation(conversations[0].id);
          }
        });
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  selectConversation(id: string): void {
    this._activeConversationId.set(id);
    this._conversations.update(list => list.map(c => (c.id === id ? { ...c, unread: 0 } : c)));

    // Trae el historial recién al abrir el hilo (evita 1 llamada "take=50" por conversación al cargar la lista).
    // El backend pagina DESC (más nuevo→más viejo); lo invertimos a ASC para renderizar cronológico.
    this.chatService.getMessages(id, { take: 50 }).subscribe({
      next: page => {
        const currentUserId = this.auth.currentUser()?.id ?? null;
        const ordered = [...page.items].reverse();
        const messages = ordered.map(dto => this.toMessage(dto, currentUserId));
        this._conversations.update(list =>
          list.map(c => (c.id === id ? { ...c, messages, hasMoreHistory: page.nextBeforeUtc !== null } : c)),
        );
        this.historyCursorByConversation.set(id, page.nextBeforeUtc);
        const last = ordered[ordered.length - 1]; // más reciente
        if (last) {
          this.noteLatestTimestamp(id, last.createdAtUtc);
          void this.socket.markRead(id, last.id);
        }
      },
      error: err => console.warn('No se pudo cargar el historial del chat:', toApiError(err).message),
    });
  }

  async sendMessage(text: string): Promise<void> {
    const conversationId = this._activeConversationId();
    if (!conversationId) {
      return;
    }
    const ack = await this.socket.sendMessage(conversationId, text);
    if (!ack.ok) {
      console.warn('No se pudo enviar el mensaje:', ack.message);
      return;
    }
    this.appendMessage(ack.value.message);
  }

  async sendAttachment(file: File): Promise<void> {
    const conversationId = this._activeConversationId();
    if (!conversationId) {
      return;
    }
    this._uploadingAttachment.set(true);
    try {
      const fileId = await firstValueFrom(this.attachments.uploadAttachment(conversationId, file));
      const ack = await this.socket.sendAttachment(conversationId, fileId);
      if (!ack.ok) {
        console.warn('No se pudo enviar el adjunto:', ack.message);
        return;
      }
      this.appendMessage(ack.value.message, { name: file.name, size: formatBytes(file.size), fileId });
    } catch (err) {
      console.warn('No se pudo subir el adjunto:', toApiError(err).message);
    } finally {
      this._uploadingAttachment.set(false);
    }
  }

  downloadAttachment(fileId: string): void {
    this.cloudStorage.getDownloadUrl(fileId).subscribe({
      next: res => window.open(res.downloadUrl, '_blank'),
      error: err => console.warn('No se pudo descargar el adjunto:', toApiError(err).message),
    });
  }

  // ---------- Typing ----------

  /**
   * Lo llama el composer en cada pulsación (true) y al enviar/vaciar/blur (false). Throttlea el
   * socket: emite `typing.start` una sola vez y `typing.stop` tras {@link TYPING_IDLE_MS} de inactividad.
   */
  notifyTyping(isTyping: boolean): void {
    const conversationId = this._activeConversationId();
    if (!conversationId) {
      return;
    }
    if (!isTyping) {
      this.stopTypingNow();
      return;
    }
    if (this.typingActiveConversationId !== conversationId) {
      this.stopTypingNow(); // por si cambió de conversación mientras escribía
      this.socket.typingStart(conversationId);
      this.typingActiveConversationId = conversationId;
    }
    clearTimeout(this.typingStopTimer);
    this.typingStopTimer = setTimeout(() => this.stopTypingNow(), TYPING_IDLE_MS);
  }

  private stopTypingNow(): void {
    clearTimeout(this.typingStopTimer);
    const active = this.typingActiveConversationId;
    if (active) {
      this.socket.typingStop(active);
      this.typingActiveConversationId = null;
    }
  }

  private applyIncomingTyping(dto: TypingDto, started: boolean): void {
    const currentUserId = this.auth.currentUser()?.id ?? null;
    if (dto.userId === currentUserId) {
      return; // eco de mi propio typing
    }
    this.clearTypingExpiry(dto.conversationId, dto.userId);
    if (started) {
      this.setTypingName(dto.conversationId, dto.displayName);
      const key = `${dto.conversationId}:${dto.userId}`;
      this.typingExpiryTimers.set(
        key,
        setTimeout(() => {
          this.typingExpiryTimers.delete(key);
          this.setTypingName(dto.conversationId, null);
        }, TYPING_EXPIRY_MS),
      );
    } else {
      this.setTypingName(dto.conversationId, null);
    }
  }

  private clearTypingExpiry(conversationId: string, userId: string): void {
    const key = `${conversationId}:${userId}`;
    const existing = this.typingExpiryTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.typingExpiryTimers.delete(key);
    }
  }

  private setTypingName(conversationId: string, name: string | null): void {
    this._conversations.update(list => list.map(c => (c.id === conversationId ? { ...c, typingName: name } : c)));
  }

  // ---------- Editar / borrar mensaje ----------

  clearMessageActionError(): void {
    this._messageActionError.set(null);
  }

  /** Edita un mensaje propio. La UI se actualiza con el broadcast `chat.message.edited`. */
  async editMessage(messageId: string, body: string): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed) {
      return;
    }
    this._messageActionError.set(null);
    const ack = await this.socket.editMessage(messageId, trimmed);
    if (!ack.ok) {
      this._messageActionError.set(ack.message);
    }
  }

  /** Borra (soft) un mensaje propio. La UI se actualiza con el broadcast `chat.message.deleted`. */
  async deleteMessage(messageId: string): Promise<void> {
    this._messageActionError.set(null);
    const ack = await this.socket.deleteMessage(messageId);
    if (!ack.ok) {
      this._messageActionError.set(ack.message);
    }
  }

  // ---------- Historial (scrollback) ----------

  /** Carga la página más vieja del hilo activo y la antepone (dedupe por id). Lo dispara el thread al llegar arriba. */
  loadOlderMessages(): void {
    const id = this._activeConversationId();
    if (!id || this._loadingOlder()) {
      return;
    }
    const cursor = this.historyCursorByConversation.get(id);
    if (!cursor) {
      return; // no hay más historial
    }
    this._loadingOlder.set(true);
    this.chatService.getMessages(id, { before: cursor, take: 50 }).subscribe({
      next: page => {
        const currentUserId = this.auth.currentUser()?.id ?? null;
        const older = [...page.items].reverse().map(dto => this.toMessage(dto, currentUserId)); // DESC→ASC
        this._conversations.update(list =>
          list.map(c => {
            if (c.id !== id) {
              return c;
            }
            const existing = new Set(c.messages.map(m => m.id));
            const deduped = older.filter(m => !existing.has(m.id));
            return { ...c, messages: [...deduped, ...c.messages], hasMoreHistory: page.nextBeforeUtc !== null };
          }),
        );
        this.historyCursorByConversation.set(id, page.nextBeforeUtc);
        this._loadingOlder.set(false);
      },
      error: err => {
        this._loadingOlder.set(false);
        console.warn('No se pudo cargar más historial:', toApiError(err).message);
      },
    });
  }

  // ---------- Nueva conversación ----------

  searchEmployees(term: string): void {
    const trimmed = term.trim();
    this._customerResults.set([]); // solo una audiencia a la vez
    if (!trimmed) {
      this._employeeResults.set([]);
      this._employeeSearchError.set(null);
      return;
    }
    this._employeeSearchLoading.set(true);
    this._employeeSearchError.set(null);
    this.directory.searchEmployees(trimmed).subscribe({
      next: results => {
        this._employeeResults.set(results);
        this._employeeSearchLoading.set(false);
      },
      error: err => {
        this._employeeSearchError.set(toApiError(err).message);
        this._employeeSearchLoading.set(false);
      },
    });
  }

  searchCustomers(term: string): void {
    const trimmed = term.trim();
    this._employeeResults.set([]); // solo una audiencia a la vez
    if (!trimmed) {
      this._customerResults.set([]);
      this._employeeSearchError.set(null);
      return;
    }
    this._employeeSearchLoading.set(true);
    this._employeeSearchError.set(null);
    this.directory.searchCustomers(trimmed).subscribe({
      next: results => {
        this._customerResults.set(results);
        this._employeeSearchLoading.set(false);
      },
      error: err => {
        this._employeeSearchError.set(toApiError(err).message);
        this._employeeSearchLoading.set(false);
      },
    });
  }

  resetNewConversationState(): void {
    this._employeeResults.set([]);
    this._customerResults.set([]);
    this._employeeSearchError.set(null);
    this._newConversationError.set(null);
    this._creatingConversation.set(false);
  }

  async startDirectConversation(entry: EmployeeDirectoryEntry): Promise<boolean> {
    return this.startDirectWith(entry.userId, entry.displayName);
  }

  /**
   * Inicia (o reabre) el chat 1:1 con un cliente usando su `portalUserId`. Los clientes
   * sin cuenta de portal (`portalUserId == null`) no son chateables — la UI ni siquiera
   * ofrece la acción, así que esto es una guarda defensiva.
   */
  async startDirectWithCustomer(entry: CustomerDirectoryEntry): Promise<boolean> {
    if (!entry.portalUserId) {
      return false;
    }
    return this.startDirectWith(entry.portalUserId, entry.displayName);
  }

  /** Núcleo compartido de start_direct (empleado o cliente): mismo comando, mismo optimismo/navegación. */
  private async startDirectWith(recipientUserId: string, displayName: string): Promise<boolean> {
    this._creatingConversation.set(true);
    this._newConversationError.set(null);
    const ack = await this.socket.startDirectConversation(recipientUserId);
    this._creatingConversation.set(false);
    if (!ack.ok) {
      this._newConversationError.set(ack.message);
      return false;
    }
    this.ensureOptimisticConversation(ack.value.conversationId, displayName);
    this.selectConversation(ack.value.conversationId);
    return true;
  }

  async createGroupConversation(title: string, members: EmployeeDirectoryEntry[]): Promise<boolean> {
    this._creatingConversation.set(true);
    this._newConversationError.set(null);
    const ack = await this.socket.startGroupConversation(
      title,
      members.map(m => m.userId),
    );
    this._creatingConversation.set(false);
    if (!ack.ok) {
      this._newConversationError.set(ack.message);
      return false;
    }
    this.ensureOptimisticConversation(ack.value.conversationId, title);
    this.selectConversation(ack.value.conversationId);
    return true;
  }

  /** El ack de start_direct/start_group no trae title/participants — se arma la fila con lo que ya elegimos en el picker. */
  private ensureOptimisticConversation(id: string, name: string): void {
    if (this._conversations().some(c => c.id === id)) {
      return;
    }
    const conversation: ChatConversation = {
      id,
      name,
      kind: 'Direct',
      peerUserId: null,
      avatarColor: avatarColorFor(id),
      presence: 'Offline',
      busyReason: null,
      typingName: null,
      readUpToMessageId: null,
      hasMoreHistory: false,
      unread: 0,
      messages: [],
    };
    this._conversations.update(list => [conversation, ...list]);
  }

  private toConversation(
    summary: ConversationSummary,
    currentUserId: string | null,
    lastMessages: MessageDto[],
  ): ChatConversation {
    const others = summary.participants.filter(p => p.userId !== currentUserId);
    const other = others[0];
    return {
      id: summary.id,
      name: summary.title ?? other?.displayName ?? 'Conversation',
      kind: summary.kind,
      // Solo hay "par" en un 1:1 real (2 participantes) — en grupo no aplica llamar.
      peerUserId: others.length === 1 ? others[0].userId : null,
      avatarColor: avatarColorFor(summary.id),
      // Sin estado inicial confiable del backend (la lista no lo trae) — se actualiza en vivo vía chat.presence.changed.
      presence: 'Offline',
      busyReason: null,
      typingName: null,
      readUpToMessageId: null,
      hasMoreHistory: false,
      unread: summary.unreadCount,
      messages: lastMessages.map(dto => this.toMessage(dto, currentUserId)),
    };
  }

  private toMessage(dto: MessageDto, currentUserId: string | null, knownAttachment?: ChatMessage['attachment']): ChatMessage {
    const isMine = !!currentUserId && dto.senderId === currentUserId;
    return {
      id: dto.id,
      senderId: isMine ? 'me' : 'them',
      text: dto.isDeleted ? '(message deleted)' : dto.kind === 'Text' ? (dto.body ?? undefined) : undefined,
      attachment:
        !dto.isDeleted && dto.kind === 'Attachment' && dto.attachmentFileId
          ? (knownAttachment ?? this.resolveAttachment(dto.attachmentFileId))
          : undefined,
      time: formatTime(dto.createdAtUtc),
      dateGroup: formatDateGroup(dto.createdAtUtc),
      isEdited: dto.isEdited,
      isDeleted: dto.isDeleted,
    };
  }

  /** MessageDto solo trae el fileId — arma un placeholder y dispara la resolución real una vez, cacheada por fileId. */
  private resolveAttachment(fileId: string): NonNullable<ChatMessage['attachment']> {
    const cached = this.fileMetaCache.get(fileId);
    if (cached) {
      return { name: cached.originalName, size: formatBytes(cached.sizeBytes), fileId };
    }
    if (!this.pendingFileMetaLookups.has(fileId)) {
      this.pendingFileMetaLookups.add(fileId);
      this.cloudStorage.getFile(fileId).subscribe({
        next: file => {
          this.fileMetaCache.set(fileId, file);
          this.pendingFileMetaLookups.delete(fileId);
          this._conversations.update(list =>
            list.map(c => ({
              ...c,
              messages: c.messages.map(m =>
                m.attachment?.fileId === fileId
                  ? { ...m, attachment: { name: file.originalName, size: formatBytes(file.sizeBytes), fileId } }
                  : m,
              ),
            })),
          );
        },
        error: () => this.pendingFileMetaLookups.delete(fileId),
      });
    }
    return { name: 'Attachment', size: '', fileId };
  }

  /** Guarda el createdAtUtc más reciente por conversación (cursor `since` del backfill). Las fechas ISO UTC comparan lexicográfico = cronológico. */
  private noteLatestTimestamp(conversationId: string, createdAtUtc: string): void {
    const prev = this.lastMessageAtByConversation.get(conversationId);
    if (!prev || createdAtUtc > prev) {
      this.lastMessageAtByConversation.set(conversationId, createdAtUtc);
    }
  }

  private appendMessage(dto: MessageDto, knownAttachment?: ChatMessage['attachment']): void {
    this.noteLatestTimestamp(dto.conversationId, dto.createdAtUtc);
    const currentUserId = this.auth.currentUser()?.id ?? null;
    const message = this.toMessage(dto, currentUserId, knownAttachment);
    const fromOther = message.senderId === 'them';
    if (fromOther) {
      // Su mensaje llegó: el indicador de "typing" ya no aplica.
      this.clearTypingExpiry(dto.conversationId, dto.senderId);
    }
    this._conversations.update(list =>
      list.map(c => {
        if (c.id !== dto.conversationId) {
          return c;
        }
        if (c.messages.some(m => m.id === message.id)) {
          return c; // ya insertado (ack local + broadcast del propio mensaje)
        }
        const isActive = this._activeConversationId() === c.id;
        return {
          ...c,
          messages: [...c.messages, message],
          typingName: fromOther ? null : c.typingName,
          unread: isActive ? 0 : c.unread + (fromOther ? 1 : 0),
        };
      }),
    );
  }

  private wireSocketEventsOnce(): void {
    if (this.socketWired) {
      return;
    }
    this.socketWired = true;

    this.socket.messageNew$.subscribe(dto => this.appendMessage(dto));

    this.socket.messageEdited$.subscribe(edit => {
      this._conversations.update(list =>
        list.map(c =>
          c.id === edit.conversationId
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === edit.messageId ? { ...m, text: edit.body, isEdited: true } : m,
                ),
              }
            : c,
        ),
      );
    });

    this.socket.messageDeleted$.subscribe(del => {
      this._conversations.update(list =>
        list.map(c =>
          c.id === del.conversationId
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === del.messageId
                    ? { ...m, text: '(message deleted)', attachment: undefined, isDeleted: true }
                    : m,
                ),
              }
            : c,
        ),
      );
    });

    this.socket.presenceChanged$.subscribe(presence => {
      this._conversations.update(list =>
        list.map(c =>
          this.otherParticipantByConversation.get(c.id) === presence.userId
            ? { ...c, presence: presence.status, busyReason: presence.busyReason }
            : c,
        ),
      );
    });

    // Typing entrante: refleja "… is typing" y auto-expira por si no llega el stop.
    this.socket.typingStarted$.subscribe(dto => this.applyIncomingTyping(dto, true));
    this.socket.typingStopped$.subscribe(dto => this.applyIncomingTyping(dto, false));

    // Read receipts: el otro leyó hasta `lastReadMessageId` → ubica el "Seen".
    this.socket.messageRead$.subscribe(receipt => {
      const currentUserId = this.auth.currentUser()?.id ?? null;
      if (receipt.userId === currentUserId) {
        return; // mi propia lectura, no el "visto" del otro
      }
      this._conversations.update(list =>
        list.map(c =>
          c.id === receipt.conversationId ? { ...c, readUpToMessageId: receipt.lastReadMessageId } : c,
        ),
      );
    });

    this.socket.attachmentFlagged$.subscribe(flag => {
      this._conversations.update(list =>
        list.map(c =>
          c.id === flag.conversationId
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === flag.messageId ? { ...m, text: '(attachment removed)', attachment: undefined } : m,
                ),
              }
            : c,
        ),
      );
    });

    // Reconexión: tras un corte, el server pudo emitir mensajes que este cliente no recibió.
    // Se refresca la lista (no-leídos/orden/nuevas) y se rellena el hilo activo con `?since=`.
    // (session.revoked lo maneja el shell, filtrado por sid — no se toca el socket acá.)
    this.socket.reconnected$.subscribe(() => this.resync());
  }

  /** Tras reconectar: refresca la lista y rellena el hilo activo con lo perdido durante el corte. */
  private resync(): void {
    this.refreshConversationList();
    const activeId = this._activeConversationId();
    if (!activeId) {
      return;
    }
    const since = this.lastMessageAtByConversation.get(activeId);
    this.chatService.getMessages(activeId, since ? { since } : { take: 50 }).subscribe({
      next: page => {
        page.items.forEach(dto => this.appendMessage(dto)); // appendMessage deduplica por id
        const last = page.items[page.items.length - 1];
        if (last) {
          void this.socket.markRead(activeId, last.id);
        }
      },
      error: err => console.warn('No se pudo re-sincronizar el hilo tras reconectar:', toApiError(err).message),
    });
  }

  /** Re-lee la lista (no-leídos + orden + conversaciones nuevas) sin descartar los mensajes ya cargados. */
  private refreshConversationList(): void {
    this.chatService.listConversations({ size: 50 }).subscribe({
      next: result => {
        const currentUserId = this.auth.currentUser()?.id ?? null;
        const activeId = this._activeConversationId();
        const existing = new Map(this._conversations().map(c => [c.id, c]));
        const merged = result.items.map(summary => {
          const other = summary.participants.find(p => p.userId !== currentUserId);
          if (other) {
            this.otherParticipantByConversation.set(summary.id, other.userId);
          }
          const prev = existing.get(summary.id);
          if (prev) {
            // Conserva mensajes/estado local; el hilo activo se mantiene en 0 (se marca leído aparte).
            return { ...prev, unread: activeId === summary.id ? 0 : summary.unreadCount };
          }
          return this.toConversation(summary, currentUserId, []);
        });
        this._conversations.set(merged);
      },
      error: err =>
        console.warn('No se pudo refrescar la lista de conversaciones tras reconectar:', toApiError(err).message),
    });
  }
}
