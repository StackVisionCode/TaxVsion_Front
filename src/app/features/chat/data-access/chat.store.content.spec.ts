import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, firstValueFrom, of } from 'rxjs';
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

/** F8d — adjuntos mediados por Communication (Scanning/Unavailable, tipo real) y reacciones en vivo. */
describe('ChatStore — F8d contenido y reacciones', () => {
  let store: ChatStore;
  let chat: Record<string, ReturnType<typeof vi.fn>>;
  let socket: Record<string, unknown>;
  let toast: { error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
  const streams = new Map<string, Subject<unknown>>();
  const stream = (name: string) => {
    if (!streams.has(name)) streams.set(name, new Subject<unknown>());
    return streams.get(name) as Subject<unknown>;
  };
  const summary = {
    id: 'c1', kind: 'Direct' as const, title: null, lastMessageAtUtc: null, updatedAtUtc: '', unreadCount: 0,
    participants: [{ userId: 'me', displayName: 'Me', isPrimaryPreparer: false }, { userId: 'ana', displayName: 'Ana', isPrimaryPreparer: false }],
  };
  const dto = (over: Record<string, unknown>) => ({
    id: 'm1', conversationId: 'c1', senderId: 'ana', senderDisplayName: 'Ana', kind: 'Text', body: 'hi', attachmentFileId: null,
    replyToMessageId: null, forwardedFromMessageId: null, isEdited: false, isDeleted: false, isPinned: false, pinnedAtUtc: null,
    pinnedByUserId: null, createdAtUtc: '2026-10-31T10:00:00Z', editedAtUtc: null, ...over,
  });

  function setup(items: unknown[], meta: unknown = { fileId: 'f1', fileName: 'w2.pdf', sizeBytes: 2048, contentType: 'application/pdf', status: 'Pending' }) {
    streams.clear();
    toast = { error: vi.fn(), info: vi.fn() };
    chat = {
      listConversations: vi.fn(() => of({ items: [summary], page: 1, size: 50, totalCount: 1 })),
      getMessages: vi.fn(() => of({ items, nextBeforeUtc: null, nextAfterUtc: null, reactionPolicy: { maxPerUser: 3, catalog: ['👍'] } })),
      getAttachmentMeta: vi.fn(() => of(meta)),
      getAttachmentDownloadUrl: vi.fn(() => of({ downloadUrl: 'https://minio.test/f1' })),
    };
    const base = {
      connected: signal(true), connect: vi.fn(), queryPresence: vi.fn(),
      markRead: vi.fn(() => Promise.resolve()), markDelivered: vi.fn(() => Promise.resolve()),
      addReaction: vi.fn(() => Promise.resolve({ ok: true, value: { wasNew: true } })),
      removeReaction: vi.fn(() => Promise.resolve({ ok: false, code: 'Chat.RateLimited', message: '' })),
    };
    socket = base;
    const proxy = new Proxy(base as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : k.endsWith('$') ? stream(k) : undefined) });
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatDirectoryService, useValue: {} },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'me' }) } },
        { provide: ChatService, useValue: chat },
        { provide: ChatSocketService, useValue: proxy },
        { provide: ChatAttachmentsService, useValue: {} },
        { provide: CloudStorageUploadService, useValue: { getFile: vi.fn(), getDownloadUrl: vi.fn() } },
        { provide: ToastService, useValue: toast },
        { provide: SoundsService, useValue: { play: vi.fn() } },
      ],
    });
    store = TestBed.inject(ChatStore);
    store.load();
    store.selectConversation('c1');
  }

  afterEach(() => TestBed.resetTestingModule());
  const messages = () => store.conversations()[0]?.messages ?? [];

  it('el adjunto se resuelve por Communication: escaneando se ve "Pending" y un rechazo lo deja "Unavailable"', () => {
    setup([dto({ kind: 'Attachment', body: null, attachmentFileId: 'f1' })]);
    expect(chat['getAttachmentMeta']).toHaveBeenCalledWith('c1', 'f1');
    expect(messages()[0]?.attachment).toMatchObject({ name: 'w2.pdf', status: 'Pending', contentType: 'application/pdf' });

    stream('attachmentFlagged$').next({ messageId: 'm1', conversationId: 'c1', fileId: 'f1', status: 'Infected' });
    expect(messages()[0]?.attachment?.status).toBe('Unavailable');
  });

  it('el visor recibe el tipo real y pide la URL a Communication (no a CloudStorage)', async () => {
    setup([dto({ kind: 'Attachment', body: null, attachmentFileId: 'f1' })], { fileId: 'f1', fileName: 'scan.png', sizeBytes: 10, contentType: 'image/png', status: 'Available' });
    const item = store.attachmentViewerItem('f1', 'Attachment');
    expect(item.contentType).toBe('image/png');
    const url = item.resolveUrl?.();
    expect(await (url instanceof Promise ? url : firstValueFrom(url ?? of('')))).toBe('https://minio.test/f1');
    expect(chat['getAttachmentDownloadUrl']).toHaveBeenCalledWith('c1', 'f1');
  });

  it('reacciones: el historial las trae, los eventos las mueven y el toggle decide agregar o quitar', async () => {
    setup([dto({ reactions: [{ emoji: '👍', count: 1, userIds: ['me'] }] })]);
    expect(store.conversations()[0]?.reactionPolicy).toEqual({ maxPerUser: 3, catalog: ['👍'] });
    expect(messages()[0]?.reactions).toEqual([{ emoji: '👍', count: 1, userIds: ['me'] }]);

    stream('reactionAdded$').next({ messageId: 'm1', conversationId: 'c1', userId: 'ana', emoji: '👍' });
    expect(messages()[0]?.reactions).toEqual([{ emoji: '👍', count: 2, userIds: ['me', 'ana'] }]);

    await store.toggleReaction('m1', '👍'); // ya es mío → quitar (el servidor lo frena por ritmo)
    expect(socket['removeReaction']).toHaveBeenCalledWith('m1', '👍');
    expect(toast.error).toHaveBeenCalledWith('Too many reactions, slow down.');

    await store.toggleReaction('m1', '🎉');
    expect(socket['addReaction']).toHaveBeenCalledWith('m1', '🎉');
  });
});
