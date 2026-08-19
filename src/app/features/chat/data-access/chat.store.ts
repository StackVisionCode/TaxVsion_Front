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
import { ConversationSummary, EmployeeDirectoryEntry, MessageDto } from './chat.model';

const AVATAR_PALETTE = ['bg-gray-900', 'bg-indigo-600', 'bg-[#7C6AE0]', 'bg-orange-500', 'bg-emerald-500'];

function avatarColorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDateGroup(iso: string): string {
  const date = new Date(iso);
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

  /** userId del otro participante por conversación 1:1 — para reflejar chat.presence.changed. */
  private readonly otherParticipantByConversation = new Map<string, string>();
  private socketWired = false;

  // ---------- Nueva conversación ----------
  private readonly _employeeResults = signal<EmployeeDirectoryEntry[]>([]);
  private readonly _employeeSearchLoading = signal(false);
  private readonly _employeeSearchError = signal<string | null>(null);
  private readonly _newConversationError = signal<string | null>(null);
  private readonly _creatingConversation = signal(false);

  readonly employeeResults = this._employeeResults.asReadonly();
  readonly employeeSearchLoading = this._employeeSearchLoading.asReadonly();
  readonly employeeSearchError = this._employeeSearchError.asReadonly();
  readonly newConversationError = this._newConversationError.asReadonly();
  readonly creatingConversation = this._creatingConversation.asReadonly();

  /** communication.group.create solo lo tiene Tenant Admin por defecto — ver MeResponse.permissions. */
  readonly canCreateGroups = computed(
    () => this.auth.currentUser()?.permissions.includes('communication.group.create') ?? false,
  );

  // ---------- Adjuntos ----------
  private readonly _uploadingAttachment = signal(false);
  readonly uploadingAttachment = this._uploadingAttachment.asReadonly();

  /** Metadata resuelta perezosamente para adjuntos ajenos/históricos (el MessageDto solo trae el fileId). */
  private readonly fileMetaCache = new Map<string, FileResponse>();
  private readonly pendingFileMetaLookups = new Set<string>();

  load(): void {
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
          if (!this._activeConversationId() && conversations.length) {
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

    // Trae el historial completo recién al abrir el hilo (evita 1 llamada "take=50" por conversación al cargar la lista).
    this.chatService.getMessages(id, { take: 50 }).subscribe({
      next: page => {
        const currentUserId = this.auth.currentUser()?.id ?? null;
        const messages = page.items.map(dto => this.toMessage(dto, currentUserId));
        this._conversations.update(list => list.map(c => (c.id === id ? { ...c, messages } : c)));
        const lastId = page.items[page.items.length - 1]?.id;
        if (lastId) {
          void this.socket.markRead(id, lastId);
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

  // ---------- Nueva conversación ----------

  searchEmployees(term: string): void {
    const trimmed = term.trim();
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

  resetNewConversationState(): void {
    this._employeeResults.set([]);
    this._employeeSearchError.set(null);
    this._newConversationError.set(null);
    this._creatingConversation.set(false);
  }

  async startDirectConversation(entry: EmployeeDirectoryEntry): Promise<boolean> {
    this._creatingConversation.set(true);
    this._newConversationError.set(null);
    const ack = await this.socket.startDirectConversation(entry.userId);
    this._creatingConversation.set(false);
    if (!ack.ok) {
      this._newConversationError.set(ack.message);
      return false;
    }
    this.ensureOptimisticConversation(ack.value.conversationId, entry.displayName);
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
      avatarColor: avatarColorFor(id),
      online: false,
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
    const other = summary.participants.find(p => p.userId !== currentUserId);
    return {
      id: summary.id,
      name: summary.title ?? other?.displayName ?? 'Conversation',
      avatarColor: avatarColorFor(summary.id),
      // Sin estado inicial confiable del backend (la lista no lo trae) — se actualiza en vivo vía chat.presence.changed.
      online: false,
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

  private appendMessage(dto: MessageDto, knownAttachment?: ChatMessage['attachment']): void {
    const currentUserId = this.auth.currentUser()?.id ?? null;
    const message = this.toMessage(dto, currentUserId, knownAttachment);
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
          unread: isActive ? 0 : c.unread + (message.senderId === 'them' ? 1 : 0),
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
            ? { ...c, messages: c.messages.map(m => (m.id === edit.messageId ? { ...m, text: edit.body } : m)) }
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
                  m.id === del.messageId ? { ...m, text: '(message deleted)', attachment: undefined } : m,
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
            ? { ...c, online: presence.status === 'Online' }
            : c,
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

    this.socket.sessionRevoked$.subscribe(() => {
      this.socket.disconnect();
    });
  }
}
