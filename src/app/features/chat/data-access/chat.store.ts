import { Injectable, inject, signal } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthService } from '@core/auth/auth.service';
import { toApiError } from '@core/models/api-error.model';
import { ChatConversation } from '../ui/chat-conversation-list/chat-conversation-list.component';
import { ChatMessage } from '../ui/chat-thread/chat-thread.component';
import { ChatService } from './chat.service';
import { ChatSocketService } from './chat-socket.service';
import { ConversationSummary, MessageDto } from './chat.model';

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
 * (ver ChatSocketService). No hay "nueva conversación" en esta UI todavía —
 * solo se conectan las conversaciones que ya existen.
 */
@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly chatService = inject(ChatService);
  private readonly socket = inject(ChatSocketService);
  private readonly auth = inject(AuthService);

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

  private toMessage(dto: MessageDto, currentUserId: string | null): ChatMessage {
    const isMine = !!currentUserId && dto.senderId === currentUserId;
    return {
      id: dto.id,
      senderId: isMine ? 'me' : 'them',
      text: dto.isDeleted ? '(message deleted)' : dto.kind === 'Text' ? (dto.body ?? undefined) : undefined,
      attachment:
        !dto.isDeleted && dto.kind === 'Attachment' && dto.attachmentFileId
          ? { name: 'Attachment', size: '' }
          : undefined,
      time: formatTime(dto.createdAtUtc),
      dateGroup: formatDateGroup(dto.createdAtUtc),
    };
  }

  private appendMessage(dto: MessageDto): void {
    const currentUserId = this.auth.currentUser()?.id ?? null;
    const message = this.toMessage(dto, currentUserId);
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

    this.socket.sessionRevoked$.subscribe(() => {
      this.socket.disconnect();
    });
  }
}
