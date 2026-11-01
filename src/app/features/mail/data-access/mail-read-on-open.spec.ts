import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { MailStore } from './mail.store';
import { MailService } from './mail.service';
import { MailSocketService } from './mail-socket.service';
import { MailUnreadStore } from './mail-unread.store';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { MessageSummary, PagedResult, ThreadSummary } from './mail.model';

const thread = (over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  threadId: 't1',
  subject: 'W-2 for 2026',
  status: 'Active',
  messageCount: 1,
  firstMessageAtUtc: '2026-10-31T10:00:00Z',
  lastMessageAtUtc: '2026-10-31T10:00:00Z',
  unreadCount: 1,
  ...over,
});

const inbound = (): MessageSummary =>
  ({
    messageId: 'm1',
    direction: 'Inbound',
    from: 'client@mail.com',
    fromDisplayName: 'Client',
    subject: 'W-2 for 2026',
    snippet: 'Here it is',
    toAddresses: null,
    occurredAtUtc: '2026-10-31T10:00:00Z',
    hasAttachments: false,
    attachmentCount: 0,
    bodyStatus: 'BodyPending',
    isRead: false,
    senderTrust: 'Verified',
  }) as MessageSummary;

const page = <T>(items: T[]): PagedResult<T> => ({
  items,
  page: 1,
  size: 20,
  totalCount: items.length,
  totalPages: 1,
  hasMore: false,
  hasPrevious: false,
});

// Abrir un hilo lo marca leído en el acto: antes esperaba a que el cuerpo bajara del buzón externo.
describe('MailStore: leído al abrir un hilo', () => {
  let markThreadRead: ReturnType<typeof vi.fn<(threadId: string) => ReturnType<MailService['markThreadRead']>>>;
  let adjustThreads: ReturnType<typeof vi.fn<(delta: number) => void>>;

  function setup(threads: ThreadSummary[], markResult: ReturnType<MailService['markThreadRead']> = of(void 0)) {
    markThreadRead = vi.fn((_threadId: string) => markResult);
    adjustThreads = vi.fn((_delta: number) => undefined);
    const service: Partial<MailService> = {
      markThreadRead,
      listThreadMessages: vi.fn(() => of(page([inbound()]))),
      // El cuerpo nunca llega: el leído no puede depender de él.
      getMessageBody: vi.fn(() => of()),
      listInboxThreads: vi.fn(() => of(page<ThreadSummary>([]))),
      listDrafts: vi.fn(() => of(page<never>([]))),
    };
    TestBed.configureTestingModule({
      providers: [
        MailStore,
        { provide: MailService, useValue: service },
        { provide: MailSocketService, useValue: { connect: vi.fn(), on: vi.fn(() => of()) } },
        { provide: MailUnreadStore, useValue: { threads: () => 0, refresh: vi.fn(), adjustThreads } },
        { provide: AuthService, useValue: { currentUser: () => null } },
        { provide: CloudStorageUploadService, useValue: {} },
      ],
    });
    const store = TestBed.inject(MailStore);
    (store as unknown as { _threads: { set(v: ThreadSummary[]): void } })._threads.set(threads);
    return store;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('baja el contador y marca los mensajes como leídos sin esperar el cuerpo', () => {
    const store = setup([thread()]);

    store.selectThread('t1');

    expect(markThreadRead).toHaveBeenCalledWith('t1');
    expect(store.threads()[0].unreadCount).toBe(0);
    // El badge del Inbox y del menú baja en el acto, sin esperar al próximo conteo del servidor.
    expect(adjustThreads).toHaveBeenCalledWith(-1);
    expect(store.messages().every(message => message.isRead)).toBe(true);
  });

  it('no llama al backend si el hilo ya estaba leído', () => {
    const store = setup([thread({ unreadCount: 0 })]);

    store.selectThread('t1');

    expect(markThreadRead).not.toHaveBeenCalled();
  });

  it('si el backend no lo guarda, vuelve al estado real', () => {
    const store = setup([thread({ unreadCount: 2 })], throwError(() => new Error('boom')));

    store.selectThread('t1');

    expect(store.threads()[0].unreadCount).toBe(2);
    expect(adjustThreads.mock.calls).toEqual([[-1], [1]]);
  });
});
