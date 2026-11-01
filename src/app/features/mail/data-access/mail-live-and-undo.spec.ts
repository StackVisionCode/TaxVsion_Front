import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Observable, Subject, of, throwError } from 'rxjs';
import { MailStore } from './mail.store';
import { InboxThreadsQuery, MailService } from './mail.service';
import { MailSocketService, MailThreadStatePayload } from './mail-socket.service';
import { MailUnreadStore } from './mail-unread.store';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ToastAction } from '@shared/ui/toast/toast.model';
import { MessageSummary, PagedResult, ThreadSummary } from './mail.model';

const thread = (over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  threadId: 't1',
  subject: 'W-2 for 2026',
  status: 'Active',
  messageCount: 2,
  firstMessageAtUtc: '2026-10-31T10:00:00Z',
  lastMessageAtUtc: '2026-10-31T10:00:00Z',
  unreadCount: 1,
  customerId: 'c1',
  ...over,
});

const inbound = (id: string, isRead = true): MessageSummary =>
  ({
    messageId: id,
    direction: 'Inbound',
    from: 'client@mail.com',
    fromDisplayName: 'Client',
    subject: 'W-2 for 2026',
    snippet: 'Here it is',
    toAddresses: null,
    occurredAtUtc: '2026-10-31T10:00:00Z',
    hasAttachments: false,
    attachmentCount: 0,
    bodyStatus: 'BodyReady',
    isRead,
    senderTrust: 'Verified',
  }) as MessageSummary;

const page = <T>(items: T[]): PagedResult<T> => ({
  items,
  page: 1,
  size: 50,
  totalCount: items.length,
  totalPages: 1,
  hasMore: false,
  hasPrevious: false,
});

// Rapidez percibida (F3): acciones optimistas con "Undo", estado de hilos en vivo y búsqueda en el servidor.
describe('MailStore: Undo, estado en vivo y búsqueda', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let threadState$: Subject<MailThreadStatePayload>;
  let info: ReturnType<typeof vi.fn<(message: string, options?: { action?: ToastAction }) => void>>;
  let error: ReturnType<typeof vi.fn<(message: string) => void>>;
  let inboxQueries: InboxThreadsQuery[];
  let inboxResponses: Array<Observable<PagedResult<ThreadSummary>>>;

  function setup(threads: ThreadSummary[] = [thread()]): MailStore {
    threadState$ = new Subject<MailThreadStatePayload>();
    inboxQueries = [];
    inboxResponses = [];
    info = vi.fn((_message: string, _options?: { action?: ToastAction }) => undefined);
    error = vi.fn((_message: string) => undefined);
    service = {
      archiveThread: vi.fn(() => of(void 0)),
      unarchiveThread: vi.fn(() => of(void 0)),
      trashMessage: vi.fn(() => of(void 0)),
      restoreMessage: vi.fn(() => of(void 0)),
      markThreadRead: vi.fn(() => of(void 0)),
      listThreadMessages: vi.fn(() => of(page([inbound('m1'), inbound('m2', false)]))),
      getMessageBody: vi.fn(() => of()),
      listDrafts: vi.fn(() => of(page<never>([]))),
      listAccounts: vi.fn(() => of([])),
      listInboxThreads: vi.fn((query: InboxThreadsQuery) => {
        inboxQueries.push(query);
        return inboxResponses.shift() ?? of(page<ThreadSummary>([]));
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        MailStore,
        { provide: MailService, useValue: service },
        {
          provide: MailSocketService,
          useValue: { connect: vi.fn(), incomingEmail$: new Subject(), threadState$ },
        },
        { provide: MailUnreadStore, useValue: { threads: () => 0, refresh: vi.fn(), adjustThreads: vi.fn() } },
        { provide: ToastService, useValue: { info, error } },
        { provide: AuthService, useValue: { currentUser: () => null } },
        { provide: CloudStorageUploadService, useValue: {} },
        { provide: CustomerDirectoryStore, useValue: { byId: () => of(new Map()), search: () => of(page([])) } },
      ],
    });
    const store = TestBed.inject(MailStore);
    store.init();
    (store as unknown as { _threads: { set(v: ThreadSummary[]): void } })._threads.set(threads);
    return store;
  }

  /** Pulsa el botón del último toast informativo. */
  const undo = () => info.mock.calls.at(-1)?.[1]?.action?.run();

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => vi.useRealTimers());

  describe('archivar', () => {
    it('saca el hilo del Inbox en el acto, lo deja leído y ofrece deshacer', () => {
      const store = setup();
      store.selectThread('t1');

      store.archiveSelectedThread();

      expect(store.activeThreads()).toEqual([]);
      expect(store.archivedThreads()[0]).toMatchObject({ threadId: 't1', unreadCount: 0 });
      expect(store.selectedThreadId()).toBeNull();
      expect(info).toHaveBeenCalledWith('Conversation archived', expect.anything());
    });

    it('"Undo" lo devuelve al Inbox sin ofrecer otro Undo', () => {
      const store = setup([thread({ unreadCount: 0 })]);
      store.selectThread('t1');
      store.archiveSelectedThread();

      undo();

      expect(service['unarchiveThread']).toHaveBeenCalledWith('t1');
      expect(store.activeThreads().map(item => item.threadId)).toEqual(['t1']);
      expect(info).toHaveBeenCalledTimes(1);
    });

    it('si el backend falla, el hilo vuelve a como estaba y se avisa', () => {
      const store = setup();
      service['archiveThread'].mockReturnValue(throwError(() => new Error('boom')));
      store.selectThread('t1');

      store.archiveSelectedThread();

      expect(store.activeThreads()[0]).toMatchObject({ threadId: 't1', status: 'Active' });
      expect(error).toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
    });
  });

  describe('papelera', () => {
    it('quita el mensaje en el acto, baja los contadores y "Undo" lo restaura', () => {
      const store = setup([thread({ unreadCount: 2 })]);
      store.selectThread('t1');

      store.trashOpenMessage('m2');

      expect(store.messages().map(message => message.messageId)).toEqual(['m1']);
      expect(store.threads()[0]).toMatchObject({ messageCount: 1 });
      expect(info).toHaveBeenCalledWith('Message moved to Trash', expect.anything());

      undo();

      expect(service['restoreMessage']).toHaveBeenCalledWith('m2');
    });

    it('si el backend falla, el mensaje vuelve al hilo', () => {
      const store = setup();
      service['trashMessage'].mockReturnValue(throwError(() => new Error('boom')));
      store.selectThread('t1');

      store.trashOpenMessage('m1');

      expect(store.messages().map(message => message.messageId)).toEqual(['m1', 'm2']);
      expect(error).toHaveBeenCalled();
    });
  });

  describe('estado en vivo (mail.thread_state)', () => {
    const state = (over: Partial<MailThreadStatePayload> = {}): MailThreadStatePayload => ({
      customerId: 'c1',
      emailThreadId: 't1',
      status: 'Active',
      unreadCount: 0,
      messageCount: 2,
      actorUserId: 'someone-else',
      ...over,
    });

    it('actualiza el hilo de la lista en el sitio, sin recargarla', () => {
      const store = setup();

      threadState$.next(state({ unreadCount: 0, status: 'Archived' }));

      expect(store.archivedThreads()[0]).toMatchObject({ threadId: 't1', unreadCount: 0 });
      expect(inboxQueries).toEqual([]);
    });

    it('un hilo que no está en la lista (p. ej. desarchivado por otro) recarga en segundo plano', () => {
      const store = setup();

      threadState$.next(state({ emailThreadId: 't9' }));

      expect(inboxQueries).toHaveLength(1);
      expect(store.threadsLoading()).toBe(false);
    });

    it('con un cliente filtrado ignora los hilos de otros clientes', () => {
      const store = setup();
      store.selectCustomer('c1');
      inboxQueries = [];

      threadState$.next(state({ customerId: 'c2', emailThreadId: 't9' }));

      expect(inboxQueries).toEqual([]);
    });
  });

  describe('búsqueda en el servidor', () => {
    it('manda lo tecleado tras una pausa y descarta la respuesta de una búsqueda anterior', () => {
      vi.useFakeTimers();
      const store = setup();
      const slow = new Subject<PagedResult<ThreadSummary>>();
      inboxResponses.push(slow, of(page([thread({ threadId: 't2', subject: 'W-2 corrected' })])));

      store.searchThreads('w');
      vi.advanceTimersByTime(300);
      store.searchThreads('w-2');
      vi.advanceTimersByTime(300);
      slow.next(page([thread({ threadId: 'stale' })]));

      expect(inboxQueries.map(query => query.search)).toEqual(['w', 'w-2']);
      expect(store.threads().map(item => item.threadId)).toEqual(['t2']);
      expect(store.threadSearch()).toBe('w-2');
    });

    it('cambiar de carpeta vacía la búsqueda y vuelve al listado normal', () => {
      vi.useFakeTimers();
      const store = setup();
      store.searchThreads('w-2');
      vi.advanceTimersByTime(300);
      inboxQueries = [];

      store.selectFolder('archived');
      vi.advanceTimersByTime(300);

      expect(store.threadSearch()).toBe('');
      expect(inboxQueries.map(query => query.search)).toEqual(['']);
    });
  });
});
