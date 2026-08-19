import { Injectable, inject, signal } from '@angular/core';
import { Socket, io } from 'socket.io-client';
import { Subject } from 'rxjs';
import { TokenService } from '@core/auth/token.service';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  AttachmentFlaggedDto,
  MessageDeletedDto,
  MessageDto,
  MessageEditedDto,
  PresenceChangedDto,
  ReadReceiptDto,
  SocketAck,
  SocketEnvelope,
  TypingDto,
} from './chat.model';

/** Nombres de evento exactos de chat-socket-events.ts en Communication (no confiar en el README, está desactualizado). */
const EVENTS = {
  sendMessage: 'chat.message.send',
  markRead: 'chat.message.mark_read',
  typingStart: 'chat.typing.start',
  typingStop: 'chat.typing.stop',
  startDirect: 'chat.conversation.start_direct',
  startGroup: 'chat.conversation.start_group',
} as const;

/**
 * Conexión Socket.IO a Communication — crear conversación, enviar/editar/
 * borrar mensaje, typing, reacciones, etc. son Socket.IO-only en el backend
 * real (no hay fallback HTTP). Un solo socket por sesión de usuario, path
 * fijo `/communication/socket.io` vía Gateway; el token va en
 * `handshake.auth.token`, nunca en la query string.
 */
@Injectable({ providedIn: 'root' })
export class ChatSocketService {
  private readonly tokenService = inject(TokenService);
  private readonly api = inject(ApiConfigService);
  private socket: Socket | null = null;

  readonly connected = signal(false);

  readonly messageNew$ = new Subject<MessageDto>();
  readonly messageEdited$ = new Subject<MessageEditedDto>();
  readonly messageDeleted$ = new Subject<MessageDeletedDto>();
  readonly messageRead$ = new Subject<ReadReceiptDto>();
  readonly typingStarted$ = new Subject<TypingDto>();
  readonly typingStopped$ = new Subject<TypingDto>();
  readonly presenceChanged$ = new Subject<PresenceChangedDto>();
  readonly attachmentFlagged$ = new Subject<AttachmentFlaggedDto>();
  readonly sessionRevoked$ = new Subject<void>();

  connect(): void {
    if (this.socket) {
      return;
    }
    const token = this.tokenService.getAccessToken();
    if (!token) {
      return;
    }
    this.socket = io(this.api.tenantBase(), {
      path: '/communication/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    this.wireEvents(this.socket);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connected.set(false);
  }

  async sendMessage(conversationId: string, body: string): Promise<SocketAck<{ message: MessageDto }>> {
    return this.emitWithAck(EVENTS.sendMessage, { clientKey: newClientKey(), conversationId, body });
  }

  /** Mismo evento que sendMessage, pero con attachmentFileId — body/attachmentFileId son mutuamente excluyentes en el backend. */
  async sendAttachment(conversationId: string, attachmentFileId: string): Promise<SocketAck<{ message: MessageDto }>> {
    return this.emitWithAck(EVENTS.sendMessage, { clientKey: newClientKey(), conversationId, attachmentFileId });
  }

  async markRead(conversationId: string, lastReadMessageId: string): Promise<SocketAck<{ markedCount: number }>> {
    return this.emitWithAck(EVENTS.markRead, { clientKey: newClientKey(), conversationId, lastReadMessageId });
  }

  /** Crea (o reabre, ver `wasCreated`) un chat 1:1. Requiere permiso communication.chat.start. */
  async startDirectConversation(
    recipientUserId: string,
  ): Promise<SocketAck<{ conversationId: string; wasCreated: boolean }>> {
    return this.emitWithAck(EVENTS.startDirect, { clientKey: newClientKey(), recipientUserId });
  }

  /** Crea un grupo nuevo (nunca dedupe). Requiere permiso communication.group.create + tenant con internalGroupsEnabled. */
  async startGroupConversation(
    title: string,
    memberUserIds: string[],
  ): Promise<SocketAck<{ conversationId: string }>> {
    return this.emitWithAck(EVENTS.startGroup, { clientKey: newClientKey(), title, memberUserIds });
  }

  typingStart(conversationId: string): void {
    this.socket?.emit(EVENTS.typingStart, { conversationId });
  }

  typingStop(conversationId: string): void {
    this.socket?.emit(EVENTS.typingStop, { conversationId });
  }

  private async emitWithAck<T>(event: string, payload: unknown): Promise<SocketAck<T>> {
    if (!this.socket?.connected) {
      return { ok: false, code: 'Socket.NotConnected', message: 'Not connected to chat server.' };
    }
    try {
      return await this.socket.timeout(10_000).emitWithAck(event, payload);
    } catch {
      return { ok: false, code: 'Socket.Timeout', message: 'The chat server did not respond in time.' };
    }
  }

  private wireEvents(socket: Socket): void {
    socket.on('connect', () => this.connected.set(true));
    socket.on('disconnect', () => this.connected.set(false));

    socket.on('chat.message.new', (envelope: SocketEnvelope<MessageDto>) => this.messageNew$.next(envelope.payload));
    socket.on('chat.message.edited', (envelope: SocketEnvelope<MessageEditedDto>) =>
      this.messageEdited$.next(envelope.payload),
    );
    socket.on('chat.message.deleted', (envelope: SocketEnvelope<MessageDeletedDto>) =>
      this.messageDeleted$.next(envelope.payload),
    );
    socket.on('chat.message.read', (envelope: SocketEnvelope<ReadReceiptDto>) => this.messageRead$.next(envelope.payload));
    socket.on('chat.typing.started', (envelope: SocketEnvelope<TypingDto>) => this.typingStarted$.next(envelope.payload));
    socket.on('chat.typing.stopped', (envelope: SocketEnvelope<TypingDto>) => this.typingStopped$.next(envelope.payload));
    socket.on('chat.presence.changed', (envelope: SocketEnvelope<PresenceChangedDto>) =>
      this.presenceChanged$.next(envelope.payload),
    );
    socket.on('chat.message.attachment_flagged', (envelope: SocketEnvelope<AttachmentFlaggedDto>) =>
      this.attachmentFlagged$.next(envelope.payload),
    );
    // Canal propio, separado de cualquier otro evento — logout forzado inmediato (ver README Communication).
    socket.on('session.revoked', () => this.sessionRevoked$.next());
  }
}

function newClientKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
