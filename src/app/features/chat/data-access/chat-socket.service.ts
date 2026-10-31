import { Injectable, inject } from '@angular/core';
import { map } from 'rxjs';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { USER_PROFILE_CHANGED_EVENT, UserProfileChangedEvent } from '@core/realtime/realtime.model';
import {
  AttachmentFlaggedDto,
  ConversationParticipantAddedDto,
  ConversationParticipantRemovedDto,
  ConversationParticipantRoleChangedDto,
  ConversationSummary,
  ConversationUpdatedDto,
  GroupRole,
  DeliveryReceiptDto,
  MessageDeletedDto,
  MessageDto,
  MessageEditedDto,
  MessageReactionChangedDto,
  MessageTranscriptUpdatedDto,
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
  markDelivered: 'chat.message.mark_delivered',
  typingStart: 'chat.typing.start',
  typingStop: 'chat.typing.stop',
  recordingStart: 'chat.recording.start',
  recordingStop: 'chat.recording.stop',
  presenceQuery: 'chat.presence.query',
  startDirect: 'chat.conversation.start_direct',
  startGroup: 'chat.conversation.start_group',
  addReaction: 'chat.message.reaction.add',
  removeReaction: 'chat.message.reaction.remove',
  // F8b: administración de grupos y silencio propio.
  addParticipant: 'chat.conversation.add_participant',
  removeParticipant: 'chat.conversation.remove_participant',
  setRole: 'chat.conversation.set_role',
  transferOwnership: 'chat.conversation.transfer_ownership',
  updateInfo: 'chat.conversation.update_info',
  setAdminsOnly: 'chat.conversation.set_admins_only',
  mute: 'chat.conversation.mute',
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
  readonly messageDelivered$ = this.realtime.on<DeliveryReceiptDto>('chat.message.delivered');
  /**
   * La oficina/otro creó (o me añadió a) una conversación. El payload es delgado (id/kind/title/creador),
   * SIN participants ni unreadCount, así que sirve solo de señal para re-leer la lista completa.
   */
  readonly conversationCreated$ = this.realtime.on<{ id: string }>('chat.conversation.created');
  /** Alguien sumó un miembro a una conversación (trae su foto, F5). */
  readonly participantAdded$ = this.realtime.on<ConversationParticipantAddedDto>('chat.conversation.participant_added');
  /** F8a: archivado (meeting terminado / ticket cerrado) y, desde 8b, datos del grupo. */
  readonly conversationUpdated$ = this.realtime.on<ConversationUpdatedDto>('chat.conversation.updated');
  /** F8b: alguien salió o lo sacaron (si soy yo, el grupo deja de estar en mi lista). */
  readonly participantRemoved$ = this.realtime.on<ConversationParticipantRemovedDto>('chat.conversation.participant_removed');
  /** F8b (D-22): cambió un rol (promoción, revocación, transferencia o sucesión). */
  readonly roleChanged$ = this.realtime.on<ConversationParticipantRoleChangedDto>('chat.conversation.participant_role_changed');
  /** Un miembro del staff cambió su nombre o su foto (`user.profile.changed`). */
  readonly userProfileChanged$ = this.realtime.on<UserProfileChangedEvent>(USER_PROFILE_CHANGED_EVENT);
  readonly typingStarted$ = this.realtime.on<TypingDto>('chat.typing.started');
  readonly typingStopped$ = this.realtime.on<TypingDto>('chat.typing.stopped');
  readonly recordingStarted$ = this.realtime.on<TypingDto>('chat.recording.started');
  readonly recordingStopped$ = this.realtime.on<TypingDto>('chat.recording.stopped');
  readonly presenceChanged$ = this.realtime.on<PresenceChangedDto>('chat.presence.changed');
  readonly attachmentFlagged$ = this.realtime.on<AttachmentFlaggedDto>('chat.message.attachment_flagged');
  /** F8d: reacciones en vivo (también las mías: el servidor las emite a toda la sala). */
  readonly reactionAdded$ = this.realtime.on<MessageReactionChangedDto>('chat.message.reaction.added');
  readonly reactionRemoved$ = this.realtime.on<MessageReactionChangedDto>('chat.message.reaction.removed');
  /** F7 — cambió el transcript de una nota de voz (Processing → Ready/Failed/Skipped). */
  readonly messageTranscriptUpdated$ = this.realtime.on<MessageTranscriptUpdatedDto>('chat.message.transcript_updated');
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

  /** Nota de voz: adjunto de audio + metadata (duración/waveform). El backend rutea el blob a la carpeta del tenant. */
  async sendVoiceNote(
    conversationId: string,
    attachmentFileId: string,
    audioDurationMs: number,
    audioWaveform: number[],
  ): Promise<SocketAck<{ message: MessageDto }>> {
    return this.realtime.emitAck(EVENTS.sendMessage, {
      clientKey: this.realtime.newClientKey(),
      conversationId,
      attachmentFileId,
      audioDurationMs,
      audioWaveform,
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

  /** Cotejo de ENTREGA: avisa que recibí hasta `upToMessageId` SIN abrir el chat (no marca leído). */
  async markDelivered(conversationId: string, upToMessageId: string): Promise<SocketAck<{ markedCount: number }>> {
    return this.realtime.emitAck(EVENTS.markDelivered, {
      clientKey: this.realtime.newClientKey(),
      conversationId,
      upToMessageId,
    });
  }

  /** Crea (o reabre, ver `wasCreated`) un chat 1:1. Requiere permiso communication.chat.start. */
  async startDirectConversation(
    recipientUserId: string,
  ): Promise<SocketAck<{ conversationId: string; wasCreated: boolean }>> {
    return this.realtime.emitAck(EVENTS.startDirect, { clientKey: this.realtime.newClientKey(), recipientUserId });
  }

  /**
   * Crea un grupo nuevo (nunca dedupe). Requiere communication.group.create + grupos encendidos en la plataforma.
   * T-12: el ack trae la fila del listado (`conversation`) para pintarla sin releer la lista.
   */
  async startGroupConversation(
    title: string,
    memberUserIds: string[],
    description?: string,
  ): Promise<SocketAck<{ conversationId: string; conversation: ConversationSummary | null }>> {
    return this.realtime.emitAck(EVENTS.startGroup, {
      clientKey: this.realtime.newClientKey(),
      title,
      memberUserIds,
      ...(description ? { description } : {}),
    });
  }

  /** F8b: alta directa (Owner/Admin o superpoder). */
  async addGroupMember(conversationId: string, newMemberUserId: string): Promise<SocketAck<unknown>> {
    return this.realtime.emitAck(EVENTS.addParticipant, { clientKey: this.realtime.newClientKey(), conversationId, newMemberUserId });
  }

  /** F8b: sin `targetUserId` = salir del grupo. */
  async removeGroupMember(conversationId: string, targetUserId?: string): Promise<SocketAck<unknown>> {
    return this.realtime.emitAck(EVENTS.removeParticipant, {
      clientKey: this.realtime.newClientKey(),
      conversationId,
      ...(targetUserId ? { targetUserId } : {}),
    });
  }

  async setGroupMemberRole(conversationId: string, targetUserId: string, role: Exclude<GroupRole, 'Owner'>): Promise<SocketAck<unknown>> {
    return this.realtime.emitAck(EVENTS.setRole, { conversationId, targetUserId, role });
  }

  async transferGroupOwnership(conversationId: string, targetUserId: string): Promise<SocketAck<unknown>> {
    return this.realtime.emitAck(EVENTS.transferOwnership, { conversationId, targetUserId });
  }

  /** Campos ausentes no cambian; `null` borra (descripción/imagen). */
  async updateGroupInfo(
    conversationId: string,
    info: { title?: string; description?: string | null; avatarFileId?: string | null },
  ): Promise<SocketAck<unknown>> {
    return this.realtime.emitAck(EVENTS.updateInfo, { conversationId, ...info });
  }

  async setGroupAdminsOnly(conversationId: string, enabled: boolean): Promise<SocketAck<unknown>> {
    return this.realtime.emitAck(EVENTS.setAdminsOnly, { conversationId, enabled });
  }

  async setConversationMuted(conversationId: string, muted: boolean): Promise<SocketAck<unknown>> {
    return this.realtime.emitAck(EVENTS.mute, { conversationId, muted });
  }

  /** F8d: agrega/quita una reacción (un emoji del catálogo; el servidor valida y aplica el tope D-24). */
  async addReaction(messageId: string, emoji: string): Promise<SocketAck<{ wasNew: boolean }>> {
    return this.realtime.emitAck(EVENTS.addReaction, { clientKey: this.realtime.newClientKey(), messageId, emoji });
  }

  async removeReaction(messageId: string, emoji: string): Promise<SocketAck<unknown>> {
    return this.realtime.emitAck(EVENTS.removeReaction, { clientKey: this.realtime.newClientKey(), messageId, emoji });
  }

  typingStart(conversationId: string): void {
    this.realtime.emitNoAck(EVENTS.typingStart, { conversationId });
  }

  typingStop(conversationId: string): void {
    this.realtime.emitNoAck(EVENTS.typingStop, { conversationId });
  }

  /** Indicador "grabando una nota de voz…": se re-emite cada ~12-15s mientras se graba (renueva el TTL). */
  recordingStart(conversationId: string): void {
    this.realtime.emitNoAck(EVENTS.recordingStart, { conversationId });
  }

  recordingStop(conversationId: string): void {
    this.realtime.emitNoAck(EVENTS.recordingStop, { conversationId });
  }

  /** Pide el estado de presencia ACTUAL de unos peers; el server responde con `chat.presence.changed`. */
  queryPresence(userIds: string[]): void {
    if (userIds.length > 0) {
      this.realtime.emitNoAck(EVENTS.presenceQuery, { userIds });
    }
  }
}
