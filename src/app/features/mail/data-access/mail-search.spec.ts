import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { MailSearchFilters, MailStore, MailSuggestions, hasValidSearchCriteria } from './mail.store';
import { InboxThreadsQuery, MailListFilters, MailService } from './mail.service';
import { MailSocketService } from './mail-socket.service';
import { MailUnreadStore } from './mail-unread.store';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import {
  CustomerSummary,
  PagedResult as CustomerPage,
} from '@core/customers/customer-summary.model';
import { ToastService } from '@shared/ui/toast/toast.service';
import {
  EmailSearchHit,
  FileSearchHit,
  MailAccount,
  MailCustomerScope,
  MailSearchResult,
  MessageSummary,
  PagedResult,
  PersonSearchHit,
  ThreadSummary,
} from './mail.model';

const page = <T>(items: T[]): PagedResult<T> => ({
  items,
  page: 1,
  size: 50,
  totalCount: items.length,
  totalPages: 1,
  hasMore: false,
  hasPrevious: false,
});

const thread = (over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  threadId: 't1',
  subject: 'W-2',
  status: 'Active',
  messageCount: 1,
  firstMessageAtUtc: '2026-11-01T10:00:00Z',
  lastMessageAtUtc: '2026-11-01T10:00:00Z',
  unreadCount: 0,
  customerId: 'c1',
  hasAttachments: false,
  ...over,
});

const email = (over: Partial<EmailSearchHit> = {}): EmailSearchHit => ({
  source: 'Thread',
  folder: 'Inbox',
  threadId: 't1',
  messageId: null,
  customerId: 'c1',
  subject: 'Factura',
  matchedField: 'Subject',
  occurredAtUtc: new Date().toISOString(),
  fromAddress: 'ana@x.com',
  fromName: 'Ana',
  toAddresses: [],
  snippet: null,
  hasAttachments: false,
  ...over,
});

const file = (over: Partial<FileSearchHit> = {}): FileSearchHit => ({
  source: 'Incoming',
  attachmentId: 'att1',
  messageId: 'm1',
  threadId: 't1',
  customerId: 'c1',
  filename: 'factura.pdf',
  contentType: 'application/pdf',
  sizeBytes: 100,
  occurredAtUtc: new Date().toISOString(),
  fromAddress: 'ana@x.com',
  fromName: 'Ana',
  toAddresses: [],
  fileId: null,
  downloadStatus: 'NotRequested',
  ...over,
});

const filters = (over: Partial<MailSearchFilters> = {}): MailSearchFilters => ({
  q: '',
  results: false,
  tab: 'emails',
  clientId: null,
  hasAttachments: false,
  unread: false,
  notClient: false,
  date: 'any',
  dateFrom: null,
  dateTo: null,
  folder: null,
  from: '',
  to: '',
  subject: '',
  searchFolder: null,
  ...over,
});

const account: MailAccount = {
  id: 'a1',
  emailAddress: 'office@firm.com',
  providerCode: 'Gmail',
  displayName: null,
  status: 'Active',
  connectedAtUtc: null,
  createdAtUtc: '',
  isOffice: true,
  ownerUserId: null,
  missingScopes: [],
};

const customer = (id: string): CustomerSummary => ({
  id,
  kind: 'Individual',
  status: 'Active',
  displayName: `Client ${id}`,
  primaryEmail: `${id}@x.com`,
  primaryPhone: null,
  createdAtUtc: '',
});

// S2: búsqueda unificada — término, modo resultados, chips (todos en el servidor) y abrir lo encontrado.
describe('MailStore: búsqueda unificada', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let inboxQueries: InboxThreadsQuery[];
  let outgoing: Array<{
    list: string;
    scope: MailCustomerScope;
    filters: MailListFilters | undefined;
  }>;
  let searchResult: MailSearchResult;
  let directorySearch: ReturnType<typeof vi.fn>;
  let toast: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let uploads: { getDownloadUrl: ReturnType<typeof vi.fn> };

  function setup(threads: ThreadSummary[] = [thread()]): MailStore {
    inboxQueries = [];
    outgoing = [];
    searchResult = { emails: [], files: [] };
    toast = { info: vi.fn(), error: vi.fn() };
    uploads = { getDownloadUrl: vi.fn(() => of({ downloadUrl: 'https://files/out' })) };
    directorySearch = vi.fn(() => of({ items: [customer('c1')] } as CustomerPage<CustomerSummary>));
    const outgoingList = (list: string) =>
      vi.fn((scope: MailCustomerScope, _p: number, _s: number, filters?: MailListFilters) => {
        outgoing.push({ list, scope, filters });
        return of(page([]));
      });
    service = {
      listAccounts: vi.fn(() => of([account])),
      listInboxThreads: vi.fn((query: InboxThreadsQuery) => {
        inboxQueries.push(query);
        return of(page(threads));
      }),
      listDrafts: outgoingList('drafts'),
      listSent: outgoingList('sent'),
      listTrash: outgoingList('trash'),
      search: vi.fn(() => of(searchResult)),
      getThread: vi.fn((id: string) =>
        of(thread({ threadId: id, lastMessageAtUtc: '2020-01-01T00:00:00Z' })),
      ),
      listThreadMessages: vi.fn(() =>
        of(
          page<MessageSummary>([
            {
              messageId: 'm1',
              direction: 'Inbound',
              from: 'a@x.com',
              fromDisplayName: null,
              subject: 'x',
              snippet: null,
              toAddresses: null,
              occurredAtUtc: '',
              hasAttachments: false,
              attachmentCount: 0,
              bodyStatus: 'BodyReady',
              isRead: true,
              senderTrust: null,
            },
            {
              messageId: 'm2',
              direction: 'Inbound',
              from: 'a@x.com',
              fromDisplayName: null,
              subject: 'x',
              snippet: null,
              toAddresses: null,
              occurredAtUtc: '',
              hasAttachments: false,
              attachmentCount: 0,
              bodyStatus: 'BodyReady',
              isRead: true,
              senderTrust: null,
            },
          ]),
        ),
      ),
      getMessageBody: vi.fn(() => of({ htmlBody: '', textBody: '', headers: {} })),
      markThreadRead: vi.fn(() => of(void 0)),
      getDraft: vi.fn((id: string) =>
        of({ draftId: id, customerId: null, attachments: [], recipients: [] }),
      ),
      requestAttachmentDownload: vi.fn(() => of({})),
      getAttachmentDownloadUrl: vi.fn(() => of({ downloadUrl: 'https://files/in' })),
    };
    TestBed.configureTestingModule({
      providers: [
        MailStore,
        { provide: MailService, useValue: service },
        {
          provide: MailSocketService,
          useValue: {
            connect: vi.fn(),
            incomingEmail$: new Subject(),
            threadState$: new Subject(),
          },
        },
        {
          provide: MailUnreadStore,
          useValue: { threads: () => 0, refresh: vi.fn(), adjustThreads: vi.fn() },
        },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'u1' }) } },
        { provide: CloudStorageUploadService, useValue: uploads },
        {
          provide: CustomerDirectoryStore,
          useValue: {
            byId: () => of(new Map([['c1', customer('c1')]])),
            search: directorySearch,
            recent: () => [],
          },
        },
      ],
    });
    const store = TestBed.inject(MailStore);
    store.init();
    inboxQueries = [];
    outgoing = [];
    return store;
  }

  beforeEach(() => TestBed.resetTestingModule());

  describe('término y chips en el servidor', () => {
    it('`q` llega a hilos y a Drafts/Sent/Trash (la carpeta abierta)', () => {
      const store = setup();
      store.selectFolder('sent');
      outgoing = [];

      store.applySearchState(filters({ q: 'factura', folder: 'sent' }));

      expect(inboxQueries.map((query) => query.search)).toEqual(['factura']);
      expect(outgoing).toEqual([
        { list: 'drafts', scope: { kind: 'all' }, filters: { q: 'factura' } },
        { list: 'sent', scope: { kind: 'all' }, filters: { q: 'factura' } },
      ]);
      expect(store.resultsMode()).toBe(false);
    });

    it('"Unread" va al servidor (`unreadOnly`) y solo recarga los hilos', () => {
      const store = setup();
      store.applySearchState(filters({ unread: true }));
      expect(inboxQueries).toEqual([{ customerId: null, search: '', unreadOnly: true }]);
      expect(outgoing).toEqual([]);
    });

    it('"Not a client" pide hilos y saliente con `unlinked` y no filtra nada en el cliente', () => {
      const store = setup([thread(), thread({ threadId: 't2', customerId: null })]);
      store.applySearchState(filters({ notClient: true }));
      expect(inboxQueries).toEqual([{ customerId: null, unlinked: true, search: '' }]);
      expect(outgoing).toEqual([
        { list: 'drafts', scope: { kind: 'unlinked' }, filters: { q: '' } },
      ]);
      // Lo que devuelve el servidor se pinta tal cual (paginación y totales reales).
      expect(store.activeThreads().map((item) => item.threadId)).toEqual(['t1', 't2']);
    });

    it('nunca manda `unlinked` y `customerId` a la vez: manda el cliente', () => {
      const store = setup();
      store.applySearchState(filters({ notClient: true }));
      inboxQueries = [];
      store.pickCustomer(customer('c1'));
      expect(inboxQueries.at(-1)).toMatchObject({ customerId: 'c1' });
      expect(inboxQueries.at(-1)?.unlinked).toBeUndefined();
      expect(store.unlinkedView()).toBe(false);

      // Aunque la URL traiga los dos, el cliente gana.
      store.applySearchState(filters({ clientId: 'c1', notClient: true, q: 'w-2', results: true }));
      const searchFilters = service['search'].mock.calls.at(-1)?.[2];
      expect(searchFilters).toMatchObject({ customerId: 'c1' });
      expect(searchFilters.unlinked).toBeUndefined();
    });

    it('el chip de cliente filtra en el servidor y resuelve el nombre para la chip', () => {
      const store = setup();
      store.applySearchState(filters({ clientId: 'c1' }));
      expect(inboxQueries[0].customerId).toBe('c1');
      expect(outgoing[0].scope).toEqual({ kind: 'customer', customerId: 'c1' });
      expect(store.selectedCustomer()?.displayName).toBe('Client c1');
    });

    it('adjuntos y fecha van al servidor en hilos y en Drafts (fecha = `fromUtc`, ahora menos N días)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
      try {
        const store = setup();
        store.applySearchState(filters({ hasAttachments: true, date: '30d' }));
        expect(inboxQueries).toEqual([
          {
            customerId: null,
            search: '',
            hasAttachments: true,
            fromUtc: '2026-10-04T12:00:00.000Z',
          },
        ]);
        expect(outgoing).toEqual([
          {
            list: 'drafts',
            scope: { kind: 'all' },
            filters: { q: '', hasAttachments: true, fromUtc: '2026-10-04T12:00:00.000Z' },
          },
        ]);

        store.applySearchState(filters({ hasAttachments: true, date: '7d' }));
        expect(inboxQueries.at(-1)?.fromUtc).toBe('2026-10-27T12:00:00.000Z');
        // "Any time" no manda rango (ni `toUtc`).
        store.applySearchState(filters({ hasAttachments: true }));
        expect(inboxQueries.at(-1)?.fromUtc).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('antes del boot de cuentas solo guarda los filtros; la primera carga ya los usa', () => {
      TestBed.resetTestingModule();
      const store = setup();
      // Simula la URL aplicada antes de que respondan las cuentas.
      (store as unknown as { listsReady: boolean }).listsReady = false;
      store.applySearchState(filters({ q: 'w-2', results: true }));
      expect(service['search']).not.toHaveBeenCalled();

      store.refreshBoot();
      expect(inboxQueries.at(-1)?.search).toBe('w-2');
      expect(service['search']).toHaveBeenCalledWith('w-2', 50, expect.any(Object));
    });
  });

  describe('modo resultados', () => {
    it('Enter busca en todas las carpetas y cada chip vuelve a pedir `/search` con sus parámetros', () => {
      const store = setup();
      searchResult = {
        emails: [email({ threadId: 't1' }), email({ threadId: 't2', customerId: null })],
        files: [file()],
      };

      store.applySearchState(filters({ q: 'factura', results: true }));
      expect(service['search']).toHaveBeenLastCalledWith('factura', 50, { groups: ['emails'] });
      expect(store.resultsMode()).toBe(true);
      // Se pinta lo que devolvió el servidor, sin filtrar.
      expect(store.searchEmails().length).toBe(2);
      expect(store.searchFiles().length).toBe(1);

      store.applySearchState(filters({ q: 'factura', results: true, notClient: true }));
      expect(service['search']).toHaveBeenLastCalledWith('factura', 50, { unlinked: true, groups: ['emails'] });

      store.applySearchState(
        filters({ q: 'factura', results: true, hasAttachments: true, unread: true }),
      );
      expect(service['search']).toHaveBeenLastCalledWith('factura', 50, {
        hasAttachments: true,
        unreadOnly: true,
        groups: ['emails'],
      });

      store.applySearchState(filters({ q: 'factura', results: true, clientId: 'c1' }));
      expect(service['search']).toHaveBeenLastCalledWith('factura', 50, { customerId: 'c1', groups: ['emails'] });
    });

    it('elegir carpeta sale del modo resultados y conserva el término', () => {
      const store = setup();
      store.applySearchState(filters({ q: 'factura', results: true }));
      store.selectFolder('drafts');
      expect(store.resultsMode()).toBe(false);
      expect(store.query()).toBe('factura');
    });

    it('un término de 1 letra no entra en modo resultados', () => {
      const store = setup();
      store.applySearchState(filters({ q: 'f', results: true }));
      expect(store.resultsMode()).toBe(false);
      expect(service['search']).not.toHaveBeenCalled();
    });
  });

  describe('abrir lo encontrado', () => {
    it('una conversación que no está cargada se pide por id, entra en la lista y expande el mensaje que coincidió', () => {
      const store = setup();
      const opened = store.openSearchEmail(email({ threadId: 't9', messageId: 'm1' }));
      expect(opened).toBe('thread');
      expect(service['getThread']).toHaveBeenCalledWith('t9');
      expect(store.selectedThreadId()).toBe('t9');
      expect(store.threads().some((item) => item.threadId === 't9')).toBe(true);
      // Sin el mensaje pedido se expandiría el último (m2).
      expect(store.expandedMessageId()).toBe('m1');
    });

    it('una conversación que ya no existe avisa', () => {
      const store = setup();
      service['getThread'].mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 404 })),
      );
      store.openThreadById('gone');
      expect(toast.error).toHaveBeenCalledWith('This conversation is no longer available.');
      expect(store.selectedThreadId()).toBeNull();
    });

    it('un enviado nuevo abre su vista suelta; un borrador, el composer; la papelera la resuelve la página', () => {
      const store = setup();
      expect(
        store.openSearchEmail(
          email({
            source: 'Outgoing',
            folder: 'Sent',
            threadId: null,
            messageId: 'd1',
            toAddresses: ['x@y.com'],
          }),
        ),
      ).toBe('sent');
      expect(store.selectedThreadId()).toBe('sent:d1');

      expect(
        store.openSearchEmail(
          email({ source: 'Outgoing', folder: 'Drafts', threadId: null, messageId: 'd2' }),
        ),
      ).toBe('draft');
      expect(service['getDraft']).toHaveBeenCalledWith('d2');
      expect(store.compose().open).toBe(true);

      expect(
        store.openSearchEmail(email({ source: 'Incoming', folder: 'Trash', messageId: 'm5' })),
      ).toBe('trash');
    });

    it('un adjunto entrante sale por el flujo bajo demanda; uno saliente, directo de CloudStorage', () => {
      const store = setup();
      const urls: string[] = [];
      store.searchFileUrl(file()).subscribe((url) => urls.push(url));
      expect(service['requestAttachmentDownload']).toHaveBeenCalledWith('m1', 'att1');

      store
        .searchFileUrl(file({ source: 'Outgoing', fileId: 'f9' }))
        .subscribe((url) => urls.push(url));
      expect(uploads.getDownloadUrl).toHaveBeenCalledWith('f9');
      expect(urls).toEqual(['https://files/in', 'https://files/out']);
    });
  });

  it('las sugerencias piden clientes y correos EN PARALELO y emiten en cuanto llega cada grupo', () => {
    const store = setup();
    const mail$ = new Subject<MailSearchResult>();
    service['search'].mockReturnValue(mail$);
    const emitted: MailSuggestions[] = [];

    store.suggest('fac').subscribe((value) => emitted.push(value));

    expect(directorySearch).toHaveBeenCalledWith({
      term: 'fac',
      status: 'NotArchived',
      page: 1,
      size: 5,
    });
    expect(service['search']).toHaveBeenCalledWith('fac', 5, { groups: ['emails', 'files', 'people'] });
    expect(emitted.at(-1)).toMatchObject({ pending: true, emails: [] });
    expect(emitted.at(-1)?.clients.map((item) => item.id)).toEqual(['c1']);

    mail$.next({ emails: [email()], files: [file()] });
    expect(emitted.at(-1)).toMatchObject({ pending: false });
    expect(emitted.at(-1)?.emails.length).toBe(1);
    expect(emitted.at(-1)?.files.length).toBe(1);
  });

  describe('F1–F3: pestañas, personas y filtros de campo', () => {
    const person = (over: Partial<PersonSearchHit> = {}): PersonSearchHit => ({
      address: 'ana@x.com',
      displayName: 'Ana',
      customerId: 'c7',
      messageCount: 3,
      lastContactAtUtc: '2026-11-01T10:00:00',
      direction: 'From',
      ...over,
    });

    it('All pide los tres grupos; ir a una pestaña ya cargada no vuelve a pedir', () => {
      const store = setup();
      store.applySearchState(filters({ q: 'factura', results: true, tab: 'all' }));
      expect(service['search']).toHaveBeenLastCalledWith('factura', 50, { groups: ['emails', 'files', 'people'] });
      const calls = service['search'].mock.calls.length;
      store.applySearchState(filters({ q: 'factura', results: true, tab: 'files' }));
      store.applySearchState(filters({ q: 'factura', results: true, tab: 'people' }));
      expect(service['search'].mock.calls.length).toBe(calls);
      expect(store.searchTab()).toBe('people');
    });

    it('entrar directo a People pide solo `people`; pasar a Emails pide solo `emails`', () => {
      const store = setup();
      store.applySearchState(filters({ q: 'factura', results: true, tab: 'people' }));
      expect(service['search']).toHaveBeenLastCalledWith('factura', 50, { groups: ['people'] });
      store.applySearchState(filters({ q: 'factura', results: true, tab: 'emails' }));
      expect(service['search']).toHaveBeenLastCalledWith('factura', 50, { groups: ['emails'] });
      expect(store.searchGroups()).toEqual(['emails']);
    });

    it('un backend sin `people` no rompe: la lista queda vacía; con `people` se pinta', () => {
      const store = setup();
      searchResult = { emails: [email()], files: [] };
      store.applySearchState(filters({ q: 'factura', results: true, tab: 'all' }));
      expect(store.searchPeople()).toEqual([]);
      expect(store.searchEmails().length).toBe(1);

      searchResult = { emails: [], files: [], people: [person()] };
      store.applySearchState(filters({ q: 'factura2', results: true, tab: 'all' }));
      expect(store.searchPeople().map((item) => item.address)).toEqual(['ana@x.com']);
    });

    it('From/To/Subject/carpeta van a `/search`; con un campo, `q` puede ir vacío', () => {
      const store = setup();
      store.applySearchState(filters({ results: true, from: 'ana@x.com', tab: 'all' }));
      expect(store.resultsMode()).toBe(true);
      expect(service['search']).toHaveBeenLastCalledWith('', 50, {
        from: 'ana@x.com',
        groups: ['emails', 'files', 'people'],
      });

      store.applySearchState(
        filters({
          q: 'w-2',
          results: true,
          from: 'ana@x.com',
          to: 'bob',
          subject: 'tax',
          searchFolder: 'sent',
          tab: 'all',
        }),
      );
      expect(service['search']).toHaveBeenLastCalledWith('w-2', 50, {
        from: 'ana@x.com',
        to: 'bob',
        subject: 'tax',
        folder: 'Sent',
        groups: ['emails', 'files', 'people'],
      });
      // Los filtros de campo no tocan los listados de carpeta (no existen allí).
      expect(inboxQueries.every((query) => !('from' in query))).toBe(true);

      // Cambiar solo la carpeta del filtro vuelve a buscar.
      const calls = service['search'].mock.calls.length;
      store.applySearchState(
        filters({ q: 'w-2', results: true, from: 'ana@x.com', to: 'bob', subject: 'tax', searchFolder: 'inbox', tab: 'all' }),
      );
      expect(service['search'].mock.calls.length).toBe(calls + 1);
    });

    it('un filtro de campo de 1 letra no es criterio: no entra en modo resultados', () => {
      const store = setup();
      store.applySearchState(filters({ results: true, from: 'a' }));
      expect(store.resultsMode()).toBe(false);
      expect(service['search']).not.toHaveBeenCalled();
      expect(hasValidSearchCriteria({ q: 'w-2', from: 'a', to: '', subject: '' })).toBe(false);
      expect(hasValidSearchCriteria({ q: '', from: '', to: 'bo', subject: '' })).toBe(true);
    });

    it('rango personalizado: `fromUtc` y `toUtc` en `/search` y en los hilos', () => {
      const store = setup();
      store.applySearchState(
        filters({ q: 'factura', results: true, date: 'custom', dateFrom: '2026-10-01', dateTo: '2026-10-31' }),
      );
      const from = new Date(2026, 9, 1).toISOString();
      const to = new Date(2026, 9, 31, 23, 59, 59, 999).toISOString();
      expect(service['search'].mock.calls.at(-1)?.[2]).toMatchObject({ fromUtc: from, toUtc: to });
      expect(inboxQueries.at(-1)).toMatchObject({ fromUtc: from, toUtc: to });
      const calls = service['search'].mock.calls.length;
      store.applySearchState(
        filters({ q: 'factura', results: true, date: 'custom', dateFrom: '2026-10-01', dateTo: '2026-10-15' }),
      );
      expect(service['search'].mock.calls.length).toBe(calls + 1);
    });

    it('las sugerencias entienden operadores: filtros al servidor y solo el texto libre al directorio', () => {
      const store = setup();
      const emitted: MailSuggestions[] = [];
      searchResult = { emails: [], files: [], people: [person()] };
      store.suggest('from:ana fac').subscribe((value) => emitted.push(value));
      expect(directorySearch).toHaveBeenLastCalledWith({ term: 'fac', status: 'NotArchived', page: 1, size: 5 });
      expect(service['search']).toHaveBeenLastCalledWith('fac', 5, {
        from: 'ana',
        groups: ['emails', 'files', 'people'],
      });
      expect(emitted.at(-1)?.people.map((item) => item.address)).toEqual(['ana@x.com']);

      directorySearch.mockClear();
      store.suggest('in:sent from:"ana perez"').subscribe();
      expect(directorySearch).not.toHaveBeenCalled();
      expect(service['search']).toHaveBeenLastCalledWith('', 5, {
        from: 'ana perez',
        folder: 'Sent',
        groups: ['emails', 'files', 'people'],
      });
    });

    it('escribirle a una persona que es cliente archiva la redacción en ese cliente (si no hay filtro)', () => {
      const store = setup();
      store.openCompose('ana@x.com', 'c7');
      expect(store.compose()).toMatchObject({ open: true, initialTo: 'ana@x.com', customerId: 'c7' });
      store.applySearchState(filters({ clientId: 'c1' }));
      store.openCompose('ana@x.com', 'c7');
      expect(store.compose().customerId).toBe('c1');
    });
  });
});
