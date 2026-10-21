import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { MailStore, ComposeSendPayload } from './mail.store';
import { MailService } from './mail.service';
import { MailSocketService } from './mail-socket.service';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { InitiateUploadRequest, InitiatedUploadResponse } from '@core/cloud-storage/cloud-storage.model';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { CustomerSummary } from '@core/customers/customer-summary.model';
import { EmbeddedCustomerContext } from '@core/customers/embedded-customer';
import { DraftDetail, MailCustomerScope, PagedResult } from './mail.model';

const emptyPage = <T>(): PagedResult<T> => ({
  items: [],
  page: 1,
  size: 20,
  totalCount: 0,
  totalPages: 0,
  hasMore: false,
  hasPrevious: false,
});

const customer = (id: string, name = 'Ana Pérez'): CustomerSummary => ({
  id,
  kind: 'Individual',
  status: 'Active',
  displayName: name,
  primaryEmail: `${id}@clientes.com`,
  primaryPhone: null,
  createdAtUtc: '2026-01-01T00:00:00',
});

const payload = (files: File[] = []): ComposeSendPayload => ({
  accountId: 'a1',
  to: 'proveedor@empresa.com',
  cc: '',
  subject: 'Factura',
  bodyHtml: '<p>Hola</p>',
  bodyText: 'Hola',
  files,
  removedFileIds: [],
});

const draftOf = (customerId: string | null): DraftDetail => ({
  draftId: 'd-old',
  customerId,
  accountId: 'a1',
  subject: 'Pendiente',
  htmlBody: '',
  textBody: null,
  status: 'Draft',
  recipients: [],
  attachments: [],
  replyContext: null,
  sentMessageId: null,
  failureReason: null,
  createdAtUtc: '2026-10-20T00:00:00',
  updatedAtUtc: '2026-10-20T00:00:00',
  lastAutoSavedAtUtc: null,
});

/**
 * Dónde se archiva un correo saliente: en el cliente que se está viendo, en ninguno ("Not a client")
 * o, dentro del perfil, SIEMPRE en el cliente del perfil. Y a quién pertenecen sus adjuntos.
 */
describe('MailStore: a qué cliente se archiva el correo', () => {
  let created: Array<string | null>;
  let uploads: InitiateUploadRequest[];
  let listed: Array<{ list: string; scope: MailCustomerScope }>;
  let currentUserId: string | null;

  function configure(embedded: { id: string; name: string } | null = null): MailStore {
    created = [];
    uploads = [];
    listed = [];
    const service: Partial<MailService> = {
      createDraft: vi.fn((customerId: string | null) => {
        created.push(customerId);
        return of({ draftId: 'd1' });
      }),
      autoSaveDraft: vi.fn(() => of(void 0)),
      attachFileToDraft: vi.fn(() => of(void 0)),
      sendDraft: vi.fn(() => of({ sentMessageId: 'm1', providerMessageId: 'p1' })),
      getDraft: vi.fn(() => of(draftOf('c9'))),
      listAccounts: vi.fn(() => of([])),
      listThreads: vi.fn(() => of(emptyPage<never>())),
      listDrafts: vi.fn((scope: MailCustomerScope) => {
        listed.push({ list: 'drafts', scope });
        return of(emptyPage<never>());
      }),
      listSent: vi.fn((scope: MailCustomerScope) => {
        listed.push({ list: 'sent', scope });
        return of(emptyPage<never>());
      }),
      listTrash: vi.fn((scope: MailCustomerScope) => {
        listed.push({ list: 'trash', scope });
        return of(emptyPage<never>());
      }),
    };
    const upload: Partial<CloudStorageUploadService> = {
      initiateUpload: vi.fn((req: InitiateUploadRequest) => {
        uploads.push(req);
        return of({
          fileId: 'f1',
          uploadUrl: 'https://minio/upload',
          formData: {},
          expiresAtUtc: '2026-10-21T00:00:00',
          status: 'PendingUpload' as InitiatedUploadResponse['status'],
        });
      }),
      uploadToPresignedUrl: vi.fn(() => of(void 0)),
      completeUpload: vi.fn(() => of({ fileId: 'f1', status: 'PendingScan' })),
    };
    const context = new EmbeddedCustomerContext();
    context.customer.set(embedded);

    TestBed.configureTestingModule({
      providers: [
        MailStore,
        { provide: MailService, useValue: service },
        { provide: MailSocketService, useValue: { connect: vi.fn(), on: vi.fn(() => of()) } },
        { provide: AuthService, useValue: { currentUser: () => (currentUserId ? { id: currentUserId } : null) } },
        { provide: CloudStorageUploadService, useValue: upload },
        {
          provide: CustomerDirectoryStore,
          useValue: { byId: () => of(new Map()), search: () => of(emptyPage()), recent: () => [] },
        },
        ...(embedded ? [{ provide: EmbeddedCustomerContext, useValue: context }] : []),
      ],
    });
    return TestBed.inject(MailStore);
  }

  const file = () => new File(['%PDF'], 'factura.pdf', { type: 'application/pdf' });

  beforeEach(() => {
    currentUserId = 'u1';
  });

  describe('en /email, viendo un cliente', () => {
    it('archiva en ese cliente y sube los adjuntos a su carpeta', () => {
      const store = configure();
      store.pickCustomer(customer('c1'));
      store.openCompose();

      store.sendCompose(payload([file()]));

      expect(created).toEqual(['c1']);
      expect(uploads[0]).toMatchObject({ ownerType: 'Customer', ownerId: 'c1', folderType: 'EmailOutgoing' });
    });

    it('"Don\'t file under this client" lo manda sin cliente y los adjuntos van a la carpeta del autor', () => {
      const store = configure();
      store.pickCustomer(customer('c1'));
      store.openCompose();
      expect(store.canUnlinkComposeCustomer()).toBe(true);

      store.unlinkComposeCustomer();
      store.sendCompose(payload([file()]));

      expect(created).toEqual([null]);
      expect(uploads[0]).toMatchObject({ ownerType: 'User', ownerId: 'u1' });
    });

    it('un draft retomado conserva su cliente aunque el rail muestre otro', () => {
      const store = configure();
      store.pickCustomer(customer('c1'));
      store.openDraft('d-old'); // el draft se creó para c9

      store.sendCompose(payload([file()]));

      expect(created).toEqual([]); // ya existe: no se crea otro
      expect(uploads[0]).toMatchObject({ ownerType: 'Customer', ownerId: 'c9' });
      expect(store.canUnlinkComposeCustomer()).toBe(false);
    });
  });

  describe('en /email, vista "Not a client"', () => {
    it('lista Sent y Drafts sin cliente, y redacta sin cliente', () => {
      const store = configure();
      store.pickCustomer(customer('c1'));
      listed = [];

      store.showUnlinkedMail();
      store.openCompose();
      store.sendCompose(payload());

      expect(listed).toEqual([
        { list: 'sent', scope: { kind: 'unlinked' } },
        { list: 'drafts', scope: { kind: 'unlinked' } },
        { list: 'drafts', scope: { kind: 'unlinked' } }, // recarga tras el envío
      ]);
      expect(store.activeFolderId()).toBe('sent');
      expect(created).toEqual([null]);
      expect(store.canUnlinkComposeCustomer()).toBe(false);
    });

    it('volver a un cliente lista otra vez su correo', () => {
      const store = configure();
      store.pickCustomer(customer('c1'));
      store.showUnlinkedMail();
      listed = [];

      store.pickCustomer(customer('c1'));

      expect(store.unlinkedView()).toBe(false);
      expect(store.activeFolderId()).toBe('conversations');
      expect(listed).toEqual([{ list: 'drafts', scope: { kind: 'customer', customerId: 'c1' } }]);
    });

    it('sin identidad del usuario no deja enviar adjuntos ni crea el draft', () => {
      currentUserId = null;
      const store = configure();
      store.showUnlinkedMail();
      store.openCompose();

      store.sendCompose(payload([file()]));

      expect(created).toEqual([]);
      expect(store.compose().sending).toBe(false);
      expect(store.compose().error).toContain('identify your user');
    });
  });

  describe('dentro del perfil del cliente (embebido)', () => {
    it('siempre archiva en el cliente del perfil y no se puede desvincular', () => {
      const store = configure({ id: 'emb1', name: 'Ana Pérez' });
      store.refreshBoot();
      store.openCompose('emb1@clientes.com');
      expect(store.canUnlinkComposeCustomer()).toBe(false);

      store.unlinkComposeCustomer(); // ignorado
      store.sendCompose(payload([file()]));

      expect(created).toEqual(['emb1']);
      expect(uploads[0]).toMatchObject({ ownerType: 'Customer', ownerId: 'emb1' });
    });

    it('la vista "Not a client" no existe en el perfil', () => {
      const store = configure({ id: 'emb1', name: 'Ana Pérez' });
      store.refreshBoot();
      listed = [];

      store.showUnlinkedMail();

      expect(store.unlinkedView()).toBe(false);
      expect(listed).toEqual([]);
    });
  });
});
