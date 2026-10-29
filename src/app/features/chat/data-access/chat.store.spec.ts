import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatDirectoryService } from './chat-directory.service';
import { ChatService } from './chat.service';
import { ChatSocketService } from './chat-socket.service';
import { CustomerDirectoryEntry } from './chat.model';
import { ChatStore } from './chat.store';
import { avatarColorFor } from '@shared/utils/avatar.util';

const customer = (displayName: string): CustomerDirectoryEntry => ({
  customerId: displayName,
  displayName,
  email: `${displayName}@example.com`,
  isActive: true,
  portalUserId: null,
});

describe('ChatStore — búsqueda de directorio', () => {
  let store: ChatStore;
  let responses: Record<string, Subject<CustomerDirectoryEntry[]>>;

  beforeEach(() => {
    responses = {};
    const directory = {
      searchCustomers: vi.fn((term: string) => (responses[term] = new Subject<CustomerDirectoryEntry[]>())),
      searchEmployees: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatDirectoryService, useValue: directory },
        { provide: AuthService, useValue: { currentUser: signal(null) } },
        { provide: ChatService, useValue: {} },
        { provide: ChatSocketService, useValue: {} },
        { provide: ChatAttachmentsService, useValue: {} },
        { provide: CloudStorageUploadService, useValue: {} },
        { provide: ToastService, useValue: {} },
      ],
    });
    store = TestBed.inject(ChatStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('una respuesta vieja que llega tarde no pisa los resultados del texto actual', () => {
    store.searchCustomers('mina');
    store.searchCustomers('minat');

    responses['minat'].next([customer('Minato')]);
    responses['mina'].next([customer('Minaya'), customer('Minato')]);

    expect(store.customerResults().map(c => c.displayName)).toEqual(['Minato']);
    expect(store.employeeSearchLoading()).toBe(false);
  });

  it('borrar el texto cancela la búsqueda en vuelo', () => {
    store.searchCustomers('mina');
    store.searchCustomers('');

    responses['mina'].next([customer('Minato')]);

    expect(store.customerResults()).toEqual([]);
    expect(store.employeeSearchLoading()).toBe(false);
  });
});

describe('ChatStore — fotos de los participantes', () => {
  let store: ChatStore;
  const streams = new Map<string, Subject<unknown>>();
  const stream = (name: string) => {
    if (!streams.has(name)) {
      streams.set(name, new Subject<unknown>());
    }
    return streams.get(name)!;
  };

  const summary = {
    id: 'c1',
    kind: 'Direct' as const,
    title: null,
    lastMessageAtUtc: null,
    updatedAtUtc: '2026-10-28T10:00:00Z',
    unreadCount: 0,
    participants: [
      { userId: 'me', displayName: 'Me', isPrimaryPreparer: false, avatarFileId: null },
      { userId: 'u-ana', displayName: 'Ana Pérez', isPrimaryPreparer: true, avatarFileId: 'f-ana' },
    ],
  };
  const group = {
    ...summary,
    id: 'g1',
    kind: 'Group' as const,
    title: 'Team',
    participants: [summary.participants[0], { userId: 'u-bob', displayName: 'Bob', isPrimaryPreparer: false }],
  };

  beforeEach(() => {
    streams.clear();
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
    const history = {
      items: [
        {
          id: 'm1',
          conversationId: 'g1',
          senderId: 'u-bob',
          senderDisplayName: 'Bob',
          senderAvatarFileId: 'f-bob',
          kind: 'Text',
          body: 'hey',
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
        },
      ],
      nextBeforeUtc: null,
      nextAfterUtc: null,
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatDirectoryService, useValue: {} },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'me' }) } },
        {
          provide: ChatService,
          useValue: {
            listConversations: () => of({ items: [summary, group], page: 1, size: 50, totalCount: 2 }),
            getMessages: (id: string) => of(id === 'g1' ? history : { items: [], nextBeforeUtc: null, nextAfterUtc: null }),
          },
        },
        { provide: ChatSocketService, useValue: socket },
        { provide: ChatAttachmentsService, useValue: {} },
        { provide: CloudStorageUploadService, useValue: {} },
        { provide: ToastService, useValue: { error: vi.fn() } },
      ],
    });
    store = TestBed.inject(ChatStore);
    store.load('c1');
  });

  afterEach(() => TestBed.resetTestingModule());

  const find = (id: string) => store.conversations().find(c => c.id === id)!;

  it('un 1:1 muestra la foto del par y su color sale de su userId', () => {
    expect(find('c1').avatarFileId).toBe('f-ana');
    expect(find('c1').avatarColor).toBe(avatarColorFor('u-ana'));
    expect(find('g1').avatarFileId).toBeNull();
  });

  it('user.profile.changed actualiza la foto en vivo (match por userId)', () => {
    stream('userProfileChanged$').next({ userId: 'u-ana', avatarFileId: 'f-ana-2' });
    expect(find('c1').avatarFileId).toBe('f-ana-2');

    stream('userProfileChanged$').next({ userId: 'u-ana', avatarFileId: null });
    expect(find('c1').avatarFileId).toBeNull();
  });

  it('el historial pone la foto del remitente y participant_added suma al miembro con la suya', () => {
    store.selectConversation('g1');
    const bob = find('g1').participants?.find(p => p.userId === 'u-bob');
    expect(bob?.avatarFileId).toBe('f-bob');
    const message = find('g1').messages[0];
    expect(message.senderUserId).toBe('u-bob');
    expect(message.senderAvatarFileId).toBe('f-bob');

    stream('participantAdded$').next({
      conversationId: 'g1',
      addedByUserId: 'me',
      newParticipantUserId: 'u-luis',
      newParticipantDisplayName: 'Luis',
      newParticipantAvatarFileId: 'f-luis',
      addedAtUtc: '2026-10-28T10:00:00Z',
    });
    expect(find('g1').participants?.find(p => p.userId === 'u-luis')?.avatarFileId).toBe('f-luis');
  });
});
