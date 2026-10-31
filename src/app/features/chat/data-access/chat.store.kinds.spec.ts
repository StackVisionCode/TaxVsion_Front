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

/** F8a — el módulo Chat solo con 1:1 y grupos; Support y la sala en su lugar; chat archivado = solo lectura. */
describe('ChatStore — F8a separación por tipo', () => {
  let store: ChatStore;
  let listConversations: ReturnType<typeof vi.fn>;
  let getMessages: ReturnType<typeof vi.fn>;
  const streams = new Map<string, Subject<unknown>>();
  const stream = (name: string) => {
    if (!streams.has(name)) streams.set(name, new Subject<unknown>());
    return streams.get(name)!;
  };

  const summary = {
    id: 'c1',
    kind: 'Direct' as const,
    title: null,
    lastMessageAtUtc: null,
    updatedAtUtc: '2026-10-31T10:00:00Z',
    unreadCount: 0,
    participants: [
      { userId: 'me', displayName: 'Me', isPrimaryPreparer: false },
      { userId: 'u-ana', displayName: 'Ana', isPrimaryPreparer: true },
    ],
  };
  const message = (overrides: Record<string, unknown>) => ({
    id: 'm-' + Math.random(),
    conversationId: 'c1',
    senderId: 'u-ana',
    senderDisplayName: 'Ana',
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
    createdAtUtc: '2026-10-31T10:01:00Z',
    editedAtUtc: null,
    ...overrides,
  });

  function setup(pageFor: (id: string) => unknown) {
    streams.clear();
    listConversations = vi.fn(() => of({ items: [summary], page: 1, size: 50, totalCount: 1, unreadByKind: { Direct: 0, Group: 0, Support: 2, Meeting: 0 } }));
    getMessages = vi.fn((id: string) => of(pageFor(id)));
    const socket = new Proxy(
      {
        connected: signal(true),
        connect: vi.fn(),
        queryPresence: vi.fn(),
        markRead: vi.fn(() => Promise.resolve()),
        markDelivered: vi.fn(() => Promise.resolve()),
      } as Record<string, unknown>,
      { get: (target, key: string) => (key in target ? target[key] : key.endsWith('$') ? stream(key) : undefined) },
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatDirectoryService, useValue: {} },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'me' }) } },
        { provide: ChatService, useValue: { listConversations, getMessages } },
        { provide: ChatSocketService, useValue: socket },
        { provide: ChatAttachmentsService, useValue: {} },
        { provide: CloudStorageUploadService, useValue: { getFile: () => new Subject() } },
        { provide: ToastService, useValue: { error: vi.fn() } },
        { provide: SoundsService, useValue: { play: vi.fn() } },
      ],
    });
    store = TestBed.inject(ChatStore);
  }

  const page = (kind: string, extra: Record<string, unknown> = {}) => ({
    items: [],
    nextBeforeUtc: null,
    nextAfterUtc: null,
    conversation: { id: 'x', kind, isArchived: false, meetingId: null, supportTicketId: null, ...extra },
  });

  it('pide solo Direct,Group y toma el no leído de Support para su propio badge', () => {
    setup(() => page('Direct'));
    store.load();
    expect(listConversations).toHaveBeenCalledWith({ size: 50, kinds: ['Direct', 'Group'] });
    expect(store.supportUnread()).toBe(2);
  });

  it('un mensaje de un ticket no entra a la lista de Chat: suma al badge de Support', () => {
    setup(() => page('Direct'));
    store.load();
    stream('messageNew$').next(message({ conversationId: 'ticket-conv', conversationKind: 'Support' }));
    stream('messageNew$').next(message({ conversationId: 'room-conv', conversationKind: 'Meeting', meetingId: 'mt1' }));
    expect(store.conversations().map(c => c.id)).toEqual(['c1']);
    expect(store.supportUnread()).toBe(3);
  });

  it('chat.conversation.updated archivado deja la conversación en solo lectura', () => {
    setup(() => page('Direct'));
    store.load();
    stream('conversationUpdated$').next({ conversationId: 'c1', kind: 'Direct', isArchived: true });
    expect(store.conversations().find(c => c.id === 'c1')?.isArchived).toBe(true);
  });

  it('el deep link a un chat de Support pide ir a /support?ticket= y no lo deja en la lista', () => {
    setup(id => (id === 'ticket-conv' ? page('Support', { supportTicketId: 't-9' }) : page('Direct')));
    store.load('ticket-conv');
    expect(store.redirect()).toEqual({ commands: ['/support'], queryParams: { ticket: 't-9' } });
    expect(store.conversations().some(c => c.id === 'ticket-conv')).toBe(false);
  });

  it('openEmbedded usa el motor del chat sin sumar la conversación a la lista ni redirigir', () => {
    setup(id => (id === 'ticket-conv' ? page('Support', { supportTicketId: 't-9', isArchived: true }) : page('Direct')));
    store.load();
    store.openEmbedded('ticket-conv', 'Billing question');

    expect(store.embeddedConversation()).toMatchObject({ id: 'ticket-conv', name: 'Billing question', embedded: true, isArchived: true });
    expect(store.conversations().some(c => c.id === 'ticket-conv')).toBe(false);
    expect(store.redirect()).toBeNull();

    stream('messageNew$').next(message({ conversationId: 'ticket-conv', conversationKind: 'Support', body: 'Agent reply' }));
    expect(store.embeddedConversation()?.messages.some(m => m.text === 'Agent reply')).toBe(true);

    store.closeEmbedded('ticket-conv');
    expect(store.embeddedConversation()).toBeNull();
  });
});
