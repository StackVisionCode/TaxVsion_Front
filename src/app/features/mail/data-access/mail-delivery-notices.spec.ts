import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { MailStore } from './mail.store';
import { MailService } from './mail.service';
import { MailIncomingEmailPayload, MailSocketService } from './mail-socket.service';
import { MailUnreadStore } from './mail-unread.store';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import {
  DeliveryNoticeSummary,
  DraftDetail,
  MailAccount,
  MessageSummary,
  PagedResult,
  ThreadSummary,
} from './mail.model';

const thread = (over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  threadId: 't1',
  subject: 'W-2',
  status: 'Active',
  messageCount: 1,
  firstMessageAtUtc: '2026-11-01T10:00:00Z',
  lastMessageAtUtc: '2026-11-01T10:00:00Z',
  unreadCount: 0,
  customerId: 'c1',
  ...over,
});

const notice = (over: Partial<DeliveryNoticeSummary> = {}): DeliveryNoticeSummary => ({
  deliveryNoticeId: 'n1',
  draftId: 'd-sent',
  recipient: 'maria@x.con',
  outcome: 'NotDelivered',
  category: 'InvalidAddress',
  reasonCode: 'invalid_address',
  statusCode: '5.1.1',
  diagnostic: null,
  suppressed: true,
  canViewOriginal: true,
  isRead: false,
  occurredAtUtc: '2026-11-02T10:00:00Z',
  receivedAtUtc: '2026-11-02T10:00:00Z',
  ...over,
});

const noticeMessage = (over: Partial<DeliveryNoticeSummary> = {}): MessageSummary => ({
  messageId: 'n1',
  direction: 'Inbound',
  from: null,
  fromDisplayName: null,
  subject: 'W-2',
  snippet: null,
  toAddresses: ['maria@x.con'],
  occurredAtUtc: '2026-11-02T10:00:00Z',
  hasAttachments: false,
  attachmentCount: 0,
  bodyStatus: null,
  isRead: false,
  senderTrust: null,
  kind: 'DeliveryNotice',
  deliveryNotice: notice(over),
});

const sentDraft: DraftDetail = {
  draftId: 'd-sent',
  customerId: 'c1',
  accountId: 'a1',
  subject: 'Your W-2',
  htmlBody: '<p>Attached</p>',
  textBody: 'Attached',
  status: 'Sent',
  recipients: [
    { address: 'maria@x.con', type: 'To', displayName: null },
    { address: 'juan@x.com', type: 'To', displayName: null },
  ],
  attachments: [
    { fileId: 'f1', filename: 'w2.pdf', contentType: 'application/pdf', sizeBytes: 10 },
    { fileId: 'f2', filename: 'notes.txt', contentType: 'text/plain', sizeBytes: 5 },
  ],
  replyContext: null,
  sentMessageId: 'm1',
  failureReason: null,
  createdAtUtc: '',
  updatedAtUtc: '',
  lastAutoSavedAtUtc: null,
};

const page = <T>(items: T[]): PagedResult<T> => ({
  items,
  page: 1,
  size: 50,
  totalCount: items.length,
  totalPages: 1,
  hasMore: false,
  hasPrevious: false,
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

// R3: avisos de no entrega en la conversación, en vivo, y las acciones de su tarjeta.
describe('MailStore: avisos de no entrega', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let incoming$: Subject<MailIncomingEmailPayload>;
  let toast: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  function setup(threads: ThreadSummary[] = [thread(), thread({ threadId: 't2' })]): MailStore {
    incoming$ = new Subject<MailIncomingEmailPayload>();
    toast = { info: vi.fn(), error: vi.fn() };
    service = {
      listAccounts: vi.fn(() => of([account])),
      listInboxThreads: vi.fn(() => of(page(threads))),
      listDrafts: vi.fn(() => of(page([]))),
      listThreadMessages: vi.fn(() => of(page([noticeMessage()]))),
      markThreadRead: vi.fn(() => of(void 0)),
      getMessageBody: vi.fn(() => of({ htmlBody: '', textBody: '', headers: {} })),
      getThread: vi.fn((id: string) =>
        of(thread({ threadId: id, customerId: null, lastMessageAtUtc: '2026-11-02T10:00:00Z' })),
      ),
      getDraft: vi.fn((id: string) =>
        of(
          id === 'd-sent'
            ? sentDraft
            : {
                ...sentDraft,
                draftId: id,
                status: 'Draft',
                recipients: [{ address: 'maria@x.con', type: 'To', displayName: null }],
              },
        ),
      ),
      resendDeliveryNotice: vi.fn(() => of({ draftId: 'd-new' })),
      createDraft: vi.fn(() => of({ draftId: 'd-other' })),
      autoSaveDraft: vi.fn(() => of(void 0)),
      attachFileToDraft: vi.fn(() => of(void 0)),
      getDeliveryNoticeOriginal: vi.fn(() =>
        of({ htmlBody: '<p>550</p>', textBody: null, headers: { From: 'mailer-daemon' } }),
      ),
      unblockAddress: vi.fn(() => of(void 0)),
    };
    TestBed.configureTestingModule({
      providers: [
        MailStore,
        { provide: MailService, useValue: service },
        {
          provide: MailSocketService,
          useValue: { connect: vi.fn(), incomingEmail$: incoming$, threadState$: new Subject() },
        },
        {
          provide: MailUnreadStore,
          useValue: { threads: () => 0, refresh: vi.fn(), adjustThreads: vi.fn() },
        },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'u1' }) } },
        { provide: CloudStorageUploadService, useValue: {} },
        {
          provide: CustomerDirectoryStore,
          useValue: { byId: () => of(new Map()), search: () => of(page([])) },
        },
      ],
    });
    const store = TestBed.inject(MailStore);
    store.init();
    return store;
  }

  beforeEach(() => TestBed.resetTestingModule());

  describe('en vivo (mail.incoming con kind delivery_notice)', () => {
    const evt = (over: Partial<MailIncomingEmailPayload> = {}): MailIncomingEmailPayload => ({
      customerId: null,
      emailThreadId: 't2',
      incomingEmailId: '',
      kind: 'delivery_notice',
      deliveryNoticeId: 'n1',
      outcome: 'NotDelivered',
      category: 'InvalidAddress',
      ...over,
    });

    it('pide SOLO ese hilo y lo sube arriba, sin recargar la lista', () => {
      const store = setup();
      service['listInboxThreads'].mockClear();

      incoming$.next(evt());

      expect(service['getThread']).toHaveBeenCalledWith('t2');
      expect(service['listInboxThreads']).not.toHaveBeenCalled();
      expect(store.threads().map((item) => item.threadId)).toEqual(['t2', 't1']);
      expect(store.threads()[0].customerId).toBeNull();
    });

    it('un hilo nuevo (aviso a quien no es cliente) entra arriba', () => {
      const store = setup();
      incoming$.next(evt({ emailThreadId: 't9' }));
      expect(store.threads().map((item) => item.threadId)).toEqual(['t9', 't1', 't2']);
    });

    it('un Delayed no mueve la conversación (D-4): se actualiza en su lugar', () => {
      const store = setup();
      incoming$.next(evt({ outcome: 'Delayed' }));
      expect(store.threads().map((item) => item.threadId)).toEqual(['t1', 't2']);
      incoming$.next(evt({ outcome: 'Delayed', emailThreadId: 't9' }));
      expect(store.threads().map((item) => item.threadId)).toEqual(['t1', 't2']);
    });

    it('con la conversación abierta recarga sus mensajes; con otro cliente filtrado, lo ignora', () => {
      const store = setup();
      store.selectThread('t2');
      service['listThreadMessages'].mockClear();
      incoming$.next(evt());
      expect(service['listThreadMessages']).toHaveBeenCalledTimes(1);

      store.selectCustomer('c1');
      service['getThread'].mockClear();
      incoming$.next(evt());
      expect(service['getThread']).not.toHaveBeenCalled();
    });
  });

  it('expandir la tarjeta de aviso no pide cuerpo al buzón', () => {
    const store = setup();
    store.selectThread('t1');
    expect(store.expandedMessageId()).toBe('n1');
    expect(service['getMessageBody']).not.toHaveBeenCalled();
  });

  describe('Fix address and resend / Resend', () => {
    it('pide el borrador clonado al backend (POST /resend) y lo abre en el composer', () => {
      const store = setup();

      store.resendFromNotice(notice(), true);

      // Sin dirección corregida: el backend usa la del aviso; se corrige en el composer.
      expect(service['resendDeliveryNotice']).toHaveBeenCalledWith('n1', null);
      expect(service['getDraft']).toHaveBeenCalledWith('d-new');
      // Ya no se arma en el front.
      expect(service['createDraft']).not.toHaveBeenCalled();
      expect(service['autoSaveDraft']).not.toHaveBeenCalled();
      expect(service['attachFileToDraft']).not.toHaveBeenCalled();
      const compose = store.compose();
      expect(compose).toMatchObject({
        open: true,
        loadingDraft: false,
        resendTo: 'maria@x.con',
        highlightRecipient: true,
      });
      expect(compose.draft?.draftId).toBe('d-new');
      expect(compose.customerId).toBe('c1');
      expect(store.noticeBusyId()).toBeNull();
    });

    it('"Resend" abre sin resaltar; con la dirección ya corregida la manda en el cuerpo', () => {
      const store = setup();
      store.resendFromNotice(notice({ reasonCode: 'mailbox_full' }), false);
      expect(store.compose().draft?.draftId).toBe('d-new');
      expect(store.compose().highlightRecipient).toBe(false);

      store.closeCompose();
      store.resendFromNotice(notice(), true, ' maria@x.com ');
      expect(service['resendDeliveryNotice']).toHaveBeenLastCalledWith('n1', ' maria@x.com ');
      expect(store.compose().resendTo).toBe('maria@x.com');
    });

    it.each([
      ['EmailAddress.Invalid', 400, "That email address isn't valid. Check it and try again."],
      [
        'Draft.AccountNotVisible',
        400,
        "You don't have access to the mailbox this email was sent from. Write a new email instead, or ask an admin for access.",
      ],
      ['DeliveryNotice.NotFound', 404, 'This delivery notice is no longer available.'],
    ])('el error %s se explica en lenguaje claro en el composer', (code, status, text) => {
      const store = setup();
      service['resendDeliveryNotice'].mockReturnValue(
        throwError(() => new HttpErrorResponse({ status, error: { code, message: 'raw' } })),
      );
      store.resendFromNotice(notice(), true);
      expect(store.compose()).toMatchObject({ open: true, loadingDraft: false, loadError: text });
      expect(store.noticeBusyId()).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  describe('View original notice', () => {
    it('pide el original solo si se puede y lo deja para el modal', () => {
      const store = setup();
      store.viewNoticeOriginal(notice({ canViewOriginal: false }));
      expect(service['getDeliveryNoticeOriginal']).not.toHaveBeenCalled();

      store.viewNoticeOriginal(notice());
      expect(service['getDeliveryNoticeOriginal']).toHaveBeenCalledWith('n1');
      expect(store.noticeOriginal()).toMatchObject({
        loading: false,
        error: null,
        original: { htmlBody: '<p>550</p>' },
      });

      store.closeNoticeOriginal();
      expect(store.noticeOriginal()).toBeNull();
    });

    it('409 (llegó por webhook) se explica en lenguaje claro', () => {
      const store = setup();
      service['getDeliveryNoticeOriginal'].mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 409 })),
      );
      store.viewNoticeOriginal(notice());
      expect(store.noticeOriginal()?.error).toBe(
        "The original notice isn't available for this message.",
      );
    });
  });

  it('Unblock quita la supresión y lo refleja en la tarjeta y en la fila', () => {
    const store = setup([thread({ latestDeliveryNotice: notice() }), thread({ threadId: 't2' })]);
    store.selectThread('t1');

    store.unblockNoticeAddress(notice());

    expect(service['unblockAddress']).toHaveBeenCalledWith('maria@x.con');
    expect(store.messages()[0].deliveryNotice?.suppressed).toBe(false);
    expect(store.threads()[0].latestDeliveryNotice?.suppressed).toBe(false);
    expect(toast.info).toHaveBeenCalledWith('Emails to maria@x.con are no longer blocked.');
  });
});
