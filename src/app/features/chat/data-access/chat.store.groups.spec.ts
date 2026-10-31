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

/** F8b — el store aplica los eventos de grupo en vivo (salidas, roles, silencio) y el ack de start_group (T-12). */
describe('ChatStore — F8b grupos', () => {
  let store: ChatStore;
  let toast: { error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
  let startGroup: ReturnType<typeof vi.fn>;
  const streams = new Map<string, Subject<unknown>>();
  const stream = (name: string) => {
    if (!streams.has(name)) streams.set(name, new Subject<unknown>());
    return streams.get(name)!;
  };

  const group = {
    id: 'g1',
    kind: 'Group' as const,
    title: 'Tax team',
    lastMessageAtUtc: null,
    updatedAtUtc: '2026-10-31T10:00:00Z',
    unreadCount: 3,
    participants: [
      { userId: 'me', displayName: 'Me', isPrimaryPreparer: false, role: 'Member' as const, actorType: 'TenantEmployee' },
      { userId: 'ana', displayName: 'Ana', isPrimaryPreparer: false, role: 'Owner' as const, actorType: 'TenantEmployee' },
      { userId: 'beto', displayName: 'Beto', isPrimaryPreparer: false, role: 'Member' as const, actorType: 'TenantEmployee' },
    ],
    description: 'Quarterly',
    adminsOnlyWrite: false,
    isMuted: true,
    myRole: 'Member' as const,
  };
  const direct = { ...group, id: 'd1', kind: 'Direct' as const, title: null, unreadCount: 2, isMuted: false, myRole: null, description: null };

  function setup() {
    streams.clear();
    toast = { error: vi.fn(), info: vi.fn() };
    startGroup = vi.fn();
    const socket = new Proxy(
      {
        connected: signal(true),
        connect: vi.fn(),
        queryPresence: vi.fn(),
        markRead: vi.fn(() => Promise.resolve()),
        markDelivered: vi.fn(() => Promise.resolve()),
        startGroupConversation: startGroup,
      } as Record<string, unknown>,
      { get: (target, key: string) => (key in target ? target[key] : key.endsWith('$') ? stream(key) : undefined) },
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatDirectoryService, useValue: {} },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'me' }) } },
        {
          provide: ChatService,
          useValue: {
            listConversations: () => of({ items: [direct, group], page: 1, size: 50, totalCount: 2 }),
            getMessages: () => of({ items: [], nextBeforeUtc: null, nextAfterUtc: null }),
          },
        },
        { provide: ChatSocketService, useValue: socket },
        { provide: ChatAttachmentsService, useValue: {} },
        { provide: CloudStorageUploadService, useValue: { getFile: () => new Subject() } },
        { provide: ToastService, useValue: toast },
        { provide: SoundsService, useValue: { play: vi.fn() } },
      ],
    });
    store = TestBed.inject(ChatStore);
    store.load();
  }

  const find = (id: string) => store.conversations().find(c => c.id === id);

  it('lee datos del grupo, mi rol y el silencio; un chat silenciado no suma al badge', () => {
    setup();
    expect(find('g1')).toMatchObject({ description: 'Quarterly', myRole: 'Member', isMuted: true });
    expect(find('g1')?.participants?.find(p => p.userId === 'ana')?.role).toBe('Owner');
    expect(find('g1')?.unread).toBe(3);
    // Sin hilo abierto al entrar (F8c): cuenta el 1:1 (2) y no el grupo silenciado (3).
    expect(store.totalUnread()).toBe(2);
  });

  it('si me sacan, el grupo sale de la lista con aviso; si sale otro, solo se quita al miembro', () => {
    setup();
    stream('participantRemoved$').next({ conversationId: 'g1', removedByUserId: 'ana', removedParticipantUserId: 'beto', reason: 'Kicked', removedAtUtc: '' });
    expect(find('g1')?.participants?.map(p => p.userId)).toEqual(['me', 'ana']);

    stream('participantRemoved$').next({ conversationId: 'g1', removedByUserId: 'ana', removedParticipantUserId: 'me', reason: 'Kicked', removedAtUtc: '' });
    expect(find('g1')).toBeUndefined();
    expect(toast.info).toHaveBeenCalledWith('You were removed from Tax team.');
  });

  it('roles y modo anuncio llegan en vivo', () => {
    setup();
    stream('roleChanged$').next({ conversationId: 'g1', userId: 'me', role: 'Admin', changedByUserId: 'ana', changedAtUtc: '' });
    stream('conversationUpdated$').next({ conversationId: 'g1', kind: 'Group', adminsOnlyWrite: true, isMuted: false });
    expect(find('g1')).toMatchObject({ myRole: 'Admin', adminsOnlyWrite: true, isMuted: false });
    expect(store.totalUnread()).toBe(5);
  });

  it('T-12: el ack de start_group trae la fila completa y queda seleccionada', async () => {
    setup();
    startGroup.mockResolvedValue({
      ok: true,
      value: { conversationId: 'g2', conversation: { ...group, id: 'g2', title: 'New group', myRole: 'Owner', isMuted: false } },
    });
    expect(await store.createGroupConversation('New group', ['ana'], 'About')).toBe(true);
    expect(startGroup).toHaveBeenCalledWith('New group', ['ana'], 'About');
    expect(find('g2')).toMatchObject({ name: 'New group', myRole: 'Owner' });
    expect(store.activeConversationId()).toBe('g2');
  });

  it('un error de start_group se muestra por código', async () => {
    setup();
    startGroup.mockResolvedValue({ ok: false, code: 'Chat.Member.SingleClientOnly', message: 'x' });
    expect(await store.createGroupConversation('G', ['c1', 'c2'])).toBe(false);
    expect(store.newConversationError()).toContain('Only one client');
  });
});
