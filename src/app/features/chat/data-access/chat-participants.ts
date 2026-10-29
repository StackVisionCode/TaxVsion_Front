import { avatarColorFor } from '@shared/utils/avatar.util';
import { ChatConversation } from '../ui/chat-conversation-list/chat-conversation-list.component';
import { ChatParticipant, ConversationParticipant, MessageDto } from './chat.model';

/**
 * Reglas de participantes y fotos del chat (puras, para testearlas sin el store).
 * Contrato del backend: campo ausente = "no se sabe, conservar lo que tengo"; null = sin foto.
 */

/** Participantes del DTO → vista. Si el DTO no trae la foto se conserva la que ya conocíamos. */
export function toChatParticipants(
  incoming: readonly ConversationParticipant[],
  previous: readonly ChatParticipant[] = [],
): ChatParticipant[] {
  const known = new Map(previous.map(p => [p.userId, p]));
  return incoming.map(p => {
    const avatarFileId = p.avatarFileId !== undefined ? p.avatarFileId : known.get(p.userId)?.avatarFileId;
    return {
      userId: p.userId,
      displayName: p.displayName,
      ...(avatarFileId !== undefined ? { avatarFileId } : {}),
    };
  });
}

/** El par de un 1:1 (exactamente otro participante), o undefined en grupos. */
export function peerOf(participants: readonly ChatParticipant[], currentUserId: string | null): ChatParticipant | undefined {
  const others = participants.filter(p => p.userId !== currentUserId);
  return others.length === 1 ? others[0] : undefined;
}

/** Color de las iniciales: por el userId del par en un 1:1 (como en el resto del CRM); en grupo, por la conversación. */
export function conversationAvatarColor(conversationId: string, peerUserId: string | null | undefined): string {
  return avatarColorFor(peerUserId || conversationId);
}

/** Recalcula los campos derivados del par (foto) tras tocar los participantes. */
export function withParticipants(
  conv: ChatConversation,
  participants: ChatParticipant[],
  currentUserId: string | null,
): ChatConversation {
  const peer = peerOf(participants, currentUserId);
  return { ...conv, participants, avatarFileId: peer?.avatarFileId ?? null };
}

/**
 * Aplica un cambio de perfil (`user.profile.changed`) a una conversación: actualiza al participante por
 * userId y, si es el par de un 1:1 sin título, también el nombre de la fila. Devuelve la misma referencia
 * si no hay nada que cambiar (evita re-render).
 */
export function applyProfileChangeToConversation(
  conv: ChatConversation,
  change: { userId: string; displayName?: string | null; avatarFileId?: string | null },
  currentUserId: string | null,
): ChatConversation {
  const participants = conv.participants ?? [];
  const target = participants.find(p => p.userId === change.userId);
  if (!target) {
    return conv;
  }
  const nextAvatar = change.avatarFileId !== undefined ? change.avatarFileId : target.avatarFileId;
  const nextName = change.displayName || target.displayName;
  if (nextAvatar === target.avatarFileId && nextName === target.displayName) {
    return conv;
  }
  const updated = participants.map(p =>
    p.userId === change.userId
      ? { ...p, displayName: nextName, ...(nextAvatar !== undefined ? { avatarFileId: nextAvatar } : {}) }
      : p,
  );
  const next = withParticipants(conv, updated, currentUserId);
  // El nombre de un 1:1 sale del par: si la fila mostraba su nombre viejo, se renombra.
  const isPeer = conv.peerUserId === change.userId;
  const name = isPeer && conv.name === target.displayName ? nextName : conv.name;
  // Los mensajes ya pintados también llevan el nombre del remitente.
  const messages =
    nextName !== target.displayName
      ? conv.messages.map(m => (m.senderUserId === change.userId ? { ...m, senderName: nextName } : m))
      : conv.messages;
  return { ...next, name, messages };
}

/** Suma (o actualiza) un participante que entró por `participant_added`. */
export function addParticipant(
  conv: ChatConversation,
  participant: ChatParticipant,
  currentUserId: string | null,
): ChatConversation {
  const participants = conv.participants ?? [];
  const exists = participants.some(p => p.userId === participant.userId);
  const updated = exists
    ? participants.map(p =>
        p.userId === participant.userId
          ? {
              ...p,
              displayName: participant.displayName || p.displayName,
              ...(participant.avatarFileId !== undefined ? { avatarFileId: participant.avatarFileId } : {}),
            }
          : p,
      )
    : [...participants, participant];
  return withParticipants(conv, updated, currentUserId);
}

/**
 * El historial trae la foto de cada remitente: completa la de los participantes que todavía no la tenían
 * (nunca pisa una conocida, que pudo llegar en vivo después).
 */
export function seedAvatarsFromHistory(
  conv: ChatConversation,
  dtos: readonly MessageDto[],
  currentUserId: string | null,
): ChatConversation {
  const participants = conv.participants ?? [];
  if (participants.length === 0) {
    return conv;
  }
  const fromHistory = new Map<string, string | null>();
  for (const dto of dtos) {
    if (dto.senderAvatarFileId !== undefined && !fromHistory.has(dto.senderId)) {
      fromHistory.set(dto.senderId, dto.senderAvatarFileId);
    }
  }
  let changed = false;
  const updated = participants.map(p => {
    if (p.avatarFileId !== undefined || !fromHistory.has(p.userId)) {
      return p;
    }
    changed = true;
    return { ...p, avatarFileId: fromHistory.get(p.userId) ?? null };
  });
  return changed ? withParticipants(conv, updated, currentUserId) : conv;
}
