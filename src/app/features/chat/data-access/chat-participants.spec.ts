import { describe, expect, it } from 'vitest';
import { avatarColorFor } from '@shared/utils/avatar.util';
import { ChatConversation } from '../ui/chat-conversation-list/chat-conversation-list.component';
import {
  addParticipant,
  applyProfileChangeToConversation,
  conversationAvatarColor,
  seedAvatarsFromHistory,
  toChatParticipants,
} from './chat-participants';
import { MessageDto } from './chat.model';

function conv(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: 'c1',
    name: 'Ana Pérez',
    kind: 'Direct',
    peerUserId: 'u-ana',
    avatarColor: 'bg-x',
    avatarFileId: 'f-ana',
    participants: [
      { userId: 'me', displayName: 'Me', avatarFileId: null },
      { userId: 'u-ana', displayName: 'Ana Pérez', avatarFileId: 'f-ana' },
    ],
    presence: 'Offline',
    busyReason: null,
    typingName: null,
    recordingName: null,
    hasMoreHistory: false,
    unread: 0,
    messages: [],
    ...overrides,
  };
}

function dto(senderId: string, senderAvatarFileId?: string | null): MessageDto {
  return {
    id: `m-${senderId}`,
    conversationId: 'c1',
    senderId,
    senderDisplayName: senderId,
    ...(senderAvatarFileId !== undefined ? { senderAvatarFileId } : {}),
    kind: 'Text',
    body: 'hi',
    attachmentFileId: null,
    replyToMessageId: null,
    forwardedFromMessageId: null,
    isEdited: false,
    isDeleted: false,
    isPinned: false,
    pinnedAtUtc: null,
    pinnedByUserId: null,
    createdAtUtc: '2026-10-28T10:00:00Z',
    editedAtUtc: null,
  };
}

describe('chat-participants', () => {
  it('toChatParticipants: si el DTO no trae la foto conserva la conocida; null la quita', () => {
    const previous = [
      { userId: 'a', displayName: 'A', avatarFileId: 'f-a' },
      { userId: 'b', displayName: 'B', avatarFileId: 'f-b' },
    ];
    const next = toChatParticipants(
      [
        { userId: 'a', displayName: 'A', isPrimaryPreparer: false },
        { userId: 'b', displayName: 'B', isPrimaryPreparer: false, avatarFileId: null },
        { userId: 'c', displayName: 'C', isPrimaryPreparer: false, avatarFileId: 'f-c' },
      ],
      previous,
    );
    expect(next.map(p => p.avatarFileId)).toEqual(['f-a', null, 'f-c']);
  });

  it('el color de un 1:1 se siembra con el userId del par (igual que en el resto del CRM)', () => {
    expect(conversationAvatarColor('c1', 'u-ana')).toBe(avatarColorFor('u-ana'));
    expect(conversationAvatarColor('c1', null)).toBe(avatarColorFor('c1'));
  });

  it('user.profile.changed actualiza la foto del par y el nombre de la fila', () => {
    const updated = applyProfileChangeToConversation(
      conv({ messages: [{ id: 'm1', senderId: 'them', senderUserId: 'u-ana', senderName: 'Ana Pérez', time: '', dateGroup: '', isEdited: false, isDeleted: false, createdAtUtc: '' }] }),
      { userId: 'u-ana', displayName: 'Ana López', avatarFileId: 'f-new' },
      'me',
    );
    expect(updated.avatarFileId).toBe('f-new');
    expect(updated.name).toBe('Ana López');
    expect(updated.participants?.find(p => p.userId === 'u-ana')?.avatarFileId).toBe('f-new');
    expect(updated.messages[0].senderName).toBe('Ana López');
  });

  it('campo ausente = se conserva; null = sin foto; otro usuario = misma referencia', () => {
    const base = conv();
    expect(applyProfileChangeToConversation(base, { userId: 'u-ana' }, 'me')).toBe(base);
    expect(applyProfileChangeToConversation(base, { userId: 'nobody', avatarFileId: 'x' }, 'me')).toBe(base);
    expect(applyProfileChangeToConversation(base, { userId: 'u-ana', avatarFileId: null }, 'me').avatarFileId).toBeNull();
  });

  it('participant_added suma al miembro con su foto (en grupo no hay foto de conversación)', () => {
    const group = conv({ kind: 'Group', peerUserId: null, avatarFileId: null, name: 'Team' });
    const next = addParticipant(group, { userId: 'u-luis', displayName: 'Luis', avatarFileId: 'f-luis' }, 'me');
    expect(next.participants?.map(p => p.userId)).toEqual(['me', 'u-ana', 'u-luis']);
    expect(next.participants?.[2].avatarFileId).toBe('f-luis');
    expect(next.avatarFileId).toBeNull();
  });

  it('el historial completa fotos desconocidas sin pisar las conocidas', () => {
    const base = conv({
      participants: [
        { userId: 'me', displayName: 'Me' },
        { userId: 'u-ana', displayName: 'Ana Pérez' },
      ],
      avatarFileId: null,
    });
    const seeded = seedAvatarsFromHistory(base, [dto('u-ana', 'f-hist'), dto('me')], 'me');
    expect(seeded.avatarFileId).toBe('f-hist');
    expect(seeded.participants?.find(p => p.userId === 'me')?.avatarFileId).toBeUndefined();

    const known = conv();
    expect(seedAvatarsFromHistory(known, [dto('u-ana', 'f-old')], 'me')).toBe(known);
  });
});
