import { Injectable, inject } from '@angular/core';
import { map } from 'rxjs';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import {
  AttachmentFlaggedDto,
  MessageDeletedDto,
  MessageDto,
  MessageEditedDto,
  PresenceChangedDto,
  ReadReceiptDto,
  SocketAck,
  TypingDto,
} from './chat.model';

/** Nombres de evento exactos de chat-socket-events.ts en Communication (no confiar en el README, está desactualizado). */
const EVENTS = {
  sendMessage: 'chat.message.send',
  editMessage: 'chat.message.edit',
  deleteMessage: 'chat.message.delete',
  markRead: 'chat.message.mark_read',
  typingStart: 'chat.typing.start',
  typingStop: 'chat.typing.stop',
  startDirect: 'chat.conversation.start_direct',
  startGroup: 'chat.conversation.start_group',
} as const;

/**
 * Fachada tipada de chat sobre {@link CommunicationRealtimeService}: mapea los eventos
 * server->cliente de chat a streams tipados y traduce los comandos a `emitAck`/`emitNoAck`.
 * NO abre su propio socket — comparte el único de Communication, cuyo ciclo de vida posee
 * el shell. Crear conversación, enviar/editar/borrar mensaje y typing son Socket.IO-only
 * en el backend real (no hay fallback HTTP).
 */
@Injectable({ providedIn: 'root' })
export class ChatSocketService {
  private readonly realtime = inject(CommunicationRealtimeService);

  readonly connected = this.realtime.connected;
  /** Se re-establece el socket tras un corte — el store re-sincroniza el historial. */
  readonly reconnected$ = this.realtime.reconnected$;

  readonly messageNew$ = this.realtime.on<MessageDto>('chat.message.new');
  readonly messageEdited$ = this.realtime.on<MessageEditedDto>('chat.message.edited');
  readonly messageDeleted$ = this.realtime.on<MessageDeletedDto>('chat.message.deleted');
  readonly messageRead$ = this.realtime.on<ReadReceiptDto>('chat.message.read');
  readonly typingStarted$ = this.realtime.on<TypingDto>('chat.typing.started');
  readonly typingStopped$ = this.realtime.on<TypingDto>('chat.typing.stopped');
  readonly presenceChanged$ = this.realtime.on<PresenceChangedDto>('chat.presence.changed');
  readonly attachmentFlagged$ = this.realtime.on<AttachmentFlaggedDto>('chat.message.attachment_flagged');
  /**
   * Emite el sessionId (sid) de la sesión revocada; el consumidor lo compara con el suyo.
   * El evento va a la sala del usuario (todos sus sockets), así que el consumidor debe
   * ignorar los que no sean de ESTA sesión — ver SessionRevocationService.
   */
  readonly sessionRevoked$ = this.realtime
    .on<{ sessionId: string | null }>('session.revoked')
    .pipe(map(payload => payload?.sessionId ?? null));

  connect(): void {
    this.realtime.connect();
  }

  disconnect(): void {
    this.realtime.disconnect();
  }

  async sendMessage(conversationId: string, body: string): Promise<SocketAck<{ message: MessageDto }>> {
    return this.realtime.emitAck(EVENTS.sendMessage, { clientKey: this.realtime.newClientKey(), conversationId, body });
  }

  /** Mismo evento que sendMessage, pero con attachmentFileId — body/attachmentFileId son mutuamente excluyentes en el backend. */
  async sendAttachment(conversationId: string, attachmentFileId: string): Promise<SocketAck<{ message: MessageDto }>> {
    return this.realtime.emitAck(EVENTS.sendMessage, {
      clientKey: this.realtime.newClientKey(),
      conversationId,
      attachmentFileId,
    });
  }

  /** Edita el texto de un mensaje propio (solo Text, solo el sender). Broadcast: chat.message.edited. */
  async editMessage(messageId: string, body: string): Promise<SocketAck<{ edited: MessageEditedDto }>> {
    return this.realtime.emitAck(EVENTS.editMessage, { clientKey: this.realtime.newClientKey(), messageId, body });
  }

  /** Borra (soft) un mensaje propio (o como moderador). Broadcast: chat.message.deleted. */
  async deleteMessage(messageId: string): Promise<SocketAck<{ deleted: MessageDeletedDto }>> {
    return this.realtime.emitAck(EVENTS.deleteMessage, { clientKey: this.realtime.newClientKey(), messageId });
  }

  async markRead(conversationId: string, lastReadMessageId: string): Promise<SocketAck<{ markedCount: number }>> {
    return this.realtime.emitAck(EVENTS.markRead, {
      clientKey: this.realtime.newClientKey(),
      conversationId,
      lastReadMessageId,
    });
  }

  /** Crea (o reabre, ver `wasCreated`) un chat 1:1. Requiere permiso communication.chat.start. */
  async startDirectConversation(
    recipientUserId: string,
  ): Promise<SocketAck<{ conversationId: string; wasCreated: boolean }>> {
    return this.realtime.emitAck(EVENTS.startDirect, { clientKey: this.realtime.newClientKey(), recipientUserId });
  }

  /** Crea un grupo nuevo (nunca dedupe). Requiere permiso communication.group.create + tenant con internalGroupsEnabled. */
  async startGroupConversation(
    title: string,
    memberUserIds: string[],
  ): Promise<SocketAck<{ conversationId: string }>> {
    return this.realtime.emitAck(EVENTS.startGroup, {
      clientKey: this.realtime.newClientKey(),
      title,
      memberUserIds,
    });
  }

  typingStart(conversationId: string): void {
    this.realtime.emitNoAck(EVENTS.typingStart, { conversationId });
  }

  typingStop(conversationId: string): void {
    this.realtime.emitNoAck(EVENTS.typingStop, { conversationId });
  }
}
