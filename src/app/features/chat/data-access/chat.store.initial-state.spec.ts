import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { SoundsService } from '@core/communication/media/sounds.service';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatDirectoryService } from './chat-directory.service';
import { ChatService } from './chat.service';
import { ChatSocketService } from './chat-socket.service';
import { ChatStore } from './chat.store';
import { chatStartErrorMessage } from './chat-start-error';

/** F8c (ADD-06 H-5, T-15, COMP-03) — sin hilo al entrar, cerrar, leer solo con el hilo a la vista y presencia en lote. */
describe('ChatStore — F8c estado inicial y lectura visible', () => {
  let store: ChatStore;
  let socket: Record<string, ReturnType<typeof vi.fn> | unknown>;
  let visibility: DocumentVisibilityState = 'visible';
  const streams = new Map<string, Subject<unknown>>();
  const stream = (name: string) => {
    if (!streams.has(name)) streams.set(name, new Subject<unknown>());
    return streams.get(name) as Subject<unknown>;
  };
  const summary = (id: string, peer: string) => ({
    id,
    kind: 'Direct' as const,
    title: null,
    lastMessageAtUtc: null,
    updatedAtUtc: '2026-10-31T10:00:00Z',
    unreadCount: 0,
    participants: [
      { userId: 'me', displayName: 'Me', isPrimaryPreparer: false },
      { userId: peer, displayName: peer, isPrimaryPreparer: false },
    ],
  });
  const message = (id: string) => ({
    id, conversationId: 'c1', senderId: 'ana', senderDisplayName: 'ana', kind: 'Text', body: 'hi', attachmentFileId: null,
    replyToMessageId: null, forwardedFromMessageId: null, isEdited: false, isDeleted: false, isPinned: false, pinnedAtUtc: null,
    pinnedByUserId: null, createdAtUtc: '2026-10-31T10:05:00Z', editedAtUtc: null, conversationKind: 'Direct',
  });

  function setup() {
    streams.clear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    const base = {
      connected: signal(true),
      connect: vi.fn(),
      queryPresence: vi.fn(),
      markRead: vi.fn(() => Promise.resolve()),
      markDelivered: vi.fn(() => Promise.resolve()),
    };
    socket = base;
    const proxy = new Proxy(base as Record<string, unknown>, {
      get: (target, key: string) => (key in target ? target[key] : key.endsWith('$') ? stream(key) : undefined),
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatDirectoryService, useValue: {} },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'me' }) } },
        {
          provide: ChatService,
          useValue: {
            listConversations: () => of({ items: [summary('c1', 'ana'), summary('c2', 'beto')], page: 1, size: 50, totalCount: 2 }),
            getMessages: () => of({ items: [], nextBeforeUtc: null, nextAfterUtc: null }),
          },
        },
        { provide: ChatSocketService, useValue: proxy },
        { provide: ChatAttachmentsService, useValue: {} },
        { provide: CloudStorageUploadService, useValue: { getFile: () => new Subject() } },
        { provide: ToastService, useValue: { error: vi.fn(), info: vi.fn() } },
        { provide: SoundsService, useValue: { play: vi.fn() } },
      ],
    });
    store = TestBed.inject(ChatStore);
    store.pageAttached.set(true);
    store.load();
  }

  afterEach(() => {
    visibility = 'visible';
    TestBed.resetTestingModule();
  });

  it('al entrar no abre ningún hilo y pide la presencia de todos los pares de una vez', () => {
    setup();
    expect(store.activeConversationId()).toBeNull();
    expect(socket['queryPresence']).toHaveBeenCalledWith(['ana', 'beto']);
  });

  it('cerrar deja la página sin conversación', () => {
    setup();
    store.selectConversation('c1');
    store.closeConversation();
    expect(store.activeConversationId()).toBeNull();
  });

  it('con la pestaña oculta un mensaje del hilo abierto queda entregado y no leído; al volver se marca leído', () => {
    setup();
    store.selectConversation('c1');
    (socket['markRead'] as ReturnType<typeof vi.fn>).mockClear();

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    stream('messageNew$').next(message('m1'));
    expect(socket['markRead']).not.toHaveBeenCalled();
    expect(socket['markDelivered']).toHaveBeenCalledWith('c1', 'm1');
    expect(store.conversations().find(c => c.id === 'c1')?.unread).toBe(1);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(socket['markRead']).toHaveBeenCalledWith('c1', 'm1');
    expect(store.conversations().find(c => c.id === 'c1')?.unread).toBe(0);
  });

  it('errores de inicio de chat por código', () => {
    expect(chatStartErrorMessage('Chat.EmployeeToEmployeeDisabled', '')).toBe('Team chat is turned off by your admin.');
    expect(chatStartErrorMessage('Directory.Unresolved', '')).toContain("isn't ready to chat yet");
  });
});
