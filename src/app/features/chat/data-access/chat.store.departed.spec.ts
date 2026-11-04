import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { SoundsService } from '@core/communication/media/sounds.service';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatDirectoryService } from './chat-directory.service';
import { ChatService } from './chat.service';
import { ChatSocketService } from './chat-socket.service';
import { ChatStore } from './chat.store';
import type { ConversationSummary } from './chat.model';

/** Direct cuyo otro participante se retiró de la oficina: sigue en la lista, en solo lectura y con su nombre. */
describe('ChatStore — Direct con el otro participante retirado', () => {
  let store: ChatStore;
  const streams = new Map<string, Subject<unknown>>();
  const stream = (name: string) => {
    if (!streams.has(name)) streams.set(name, new Subject<unknown>());
    return streams.get(name)!;
  };

  const base: ConversationSummary = {
    id: 'c1',
    kind: 'Direct',
    title: null,
    lastMessageAtUtc: null,
    updatedAtUtc: '2026-11-03T10:00:00Z',
    unreadCount: 0,
    participants: [
      { userId: 'me', displayName: 'Me', isPrimaryPreparer: false },
      { userId: 'u-lena', displayName: 'Lena Hart', isPrimaryPreparer: false, avatarFileId: 'f-lena', actorType: 'TenantEmployee' },
    ],
  };

  function setup(summary: ConversationSummary) {
    streams.clear();
    const socket = new Proxy(
      { connected: signal(true), connect: vi.fn(), queryPresence: vi.fn(), markRead: vi.fn(() => Promise.resolve()), markDelivered: vi.fn(() => Promise.resolve()) } as Record<string, unknown>,
      { get: (target, key: string) => (key in target ? target[key] : key.endsWith('$') ? stream(key) : undefined) },
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatDirectoryService, useValue: {} },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'me' }) } },
        { provide: ChatService, useValue: { listConversations: vi.fn(() => of({ items: [summary], page: 1, size: 50, totalCount: 1 })), getMessages: vi.fn(() => of({ items: [], nextBeforeUtc: null, nextAfterUtc: null })) } },
        { provide: ChatSocketService, useValue: socket },
        { provide: ChatAttachmentsService, useValue: {} },
        { provide: CloudStorageUploadService, useValue: { getFile: () => new Subject() } },
        { provide: ToastService, useValue: { error: vi.fn() } },
        { provide: SoundsService, useValue: { play: vi.fn() } },
      ],
    });
    store = TestBed.inject(ChatStore);
    store.load();
  }

  const row = () => store.conversations().find(c => c.id === 'c1')!;

  it('al cargar: título, foto e iniciales de quien se fue, sin par para llamar (antes salía "Conversation")', () => {
    setup({
      ...base,
      participants: [base.participants[0]],
      isClosedForWriting: true,
      closedReason: 'ParticipantLeft',
      departedParticipant: { userId: 'u-lena', displayName: 'Lena Hart', actorType: 'TenantEmployee', avatarFileId: 'f-lena' },
    });
    expect(row().name).toBe('Lena Hart');
    expect(row().avatarFileId).toBe('f-lena');
    expect(row().peerUserId).toBeNull();
    expect(row().departedParticipant?.userId).toBe('u-lena');
  });

  it('en vivo (chat abierto): updated + participant_removed lo dejan en solo lectura sin perder nombre ni foto', () => {
    setup(base);
    expect(row().peerUserId).toBe('u-lena');

    stream('conversationUpdated$').next({
      conversationId: 'c1',
      kind: 'Direct',
      isClosedForWriting: true,
      closedReason: 'ParticipantLeft',
      departedParticipant: { userId: 'u-lena', displayName: 'Lena Hart', actorType: 'TenantEmployee' },
    });
    stream('participantRemoved$').next({ conversationId: 'c1', removedByUserId: 'u-lena', removedParticipantUserId: 'u-lena', reason: 'Kicked', removedAtUtc: '2026-11-03T11:00:00Z' });

    expect(store.conversations().map(c => c.id)).toEqual(['c1']);
    expect(row().name).toBe('Lena Hart');
    expect(row().departedParticipant).toMatchObject({ userId: 'u-lena', avatarFileId: 'f-lena' });
    expect(row().avatarFileId).toBe('f-lena');
    expect(row().peerUserId).toBeNull();
  });

  it('el mensaje de sistema conserva su origen para el ícono', () => {
    setup(base);
    stream('messageNew$').next({
      id: 's1', conversationId: 'c1', conversationKind: 'Direct', senderId: '00000000-0000-0000-0000-000000000000', senderDisplayName: 'System',
      kind: 'System', systemKind: 'Membership', body: 'Lena Hart is no longer with the office', attachmentFileId: null, replyToMessageId: null,
      forwardedFromMessageId: null, isEdited: false, isDeleted: false, isPinned: false, pinnedAtUtc: null, pinnedByUserId: null,
      createdAtUtc: '2026-11-03T11:00:00Z', editedAtUtc: null,
    });
    const system = row().messages.find(m => m.id === 's1');
    expect(system).toMatchObject({ isSystem: true, systemKind: 'Membership' });
  });
});
