import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject, of } from 'rxjs';
import { MailPageComponent } from './mail-page.component';
import { MailStore } from '../../data-access/mail.store';
import { MailService } from '../../data-access/mail.service';
import { MailSocketService } from '../../data-access/mail-socket.service';
import { MailUnreadStore } from '../../data-access/mail-unread.store';
import { CorrespondenceCapabilities } from '../../data-access/correspondence-permissions';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { StoragePolicyService } from '@core/cloud-storage/storage-policy.service';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { AvatarUrlService } from '@core/profile-photo/avatar-url';
import { ToastService } from '@shared/ui/toast/toast.service';
import { EmailSearchHit, FileSearchHit, MailAccount, MailSearchResult, PagedResult, PersonSearchHit } from '../../data-access/mail.model';

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

const email = (over: Partial<EmailSearchHit> = {}): EmailSearchHit => ({
  source: 'Thread',
  folder: 'Inbox',
  threadId: 't1',
  messageId: null,
  customerId: null,
  subject: 'Factura octubre',
  matchedField: 'Subject',
  occurredAtUtc: '2026-11-01T10:00:00',
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
  customerId: null,
  filename: 'factura.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  occurredAtUtc: '2026-11-01T10:00:00',
  fromAddress: 'ana@x.com',
  fromName: 'Ana',
  toAddresses: [],
  fileId: null,
  downloadStatus: 'NotRequested',
  ...over,
});

const person = (over: Partial<PersonSearchHit> = {}): PersonSearchHit => ({
  address: 'ana@x.com',
  displayName: 'Ana Pérez',
  customerId: null,
  messageCount: 4,
  lastContactAtUtc: '2026-11-01T10:00:00',
  direction: 'From',
  ...over,
});

// F1–F3 sobre la página real: pestañas, recientes, personas, operadores y panel de filtros.
describe('MailPageComponent: búsqueda tipo Outlook', () => {
  let search: ReturnType<typeof vi.fn>;
  let result: MailSearchResult;
  let harness: RouterTestingHarness;

  async function setup(): Promise<MailPageComponent> {
    localStorage.clear();
    result = {
      emails: [email(), email({ threadId: 't2', subject: 'Factura 2' })],
      files: [file(), file({ attachmentId: 'att2', filename: 'b.pdf' }), file({ attachmentId: 'att3', filename: 'c.pdf' }), file({ attachmentId: 'att4', filename: 'd.pdf' })],
      people: [person(), person({ address: 'bob@y.com', displayName: 'Bob', customerId: 'c9' }), person({ address: 'c@z.com', displayName: 'Carla' }), person({ address: 'd@z.com', displayName: 'Dan' })],
    };
    search = vi.fn(() => of(result));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'email', component: MailPageComponent }]),
        {
          provide: MailService,
          useValue: {
            listAccounts: () => of([account]),
            listInboxThreads: () => of(page([])),
            listDrafts: () => of(page([])),
            listSent: () => of(page([])),
            listTrash: () => of(page([])),
            search,
            getThread: () => of(null),
          },
        },
        { provide: MailSocketService, useValue: { connect: vi.fn(), disconnect: vi.fn(), incomingEmail$: new Subject(), threadState$: new Subject() } },
        { provide: MailUnreadStore, useValue: { threads: () => 0, refresh: vi.fn(), adjustThreads: vi.fn() } },
        { provide: ToastService, useValue: { info: vi.fn(), error: vi.fn(), success: vi.fn() } },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'u1', tenant: { id: 't1' }, email: 'me@firm.com' }) } },
        { provide: CloudStorageUploadService, useValue: { getDownloadUrl: vi.fn() } },
        { provide: StoragePolicyService, useValue: { uploadPolicy: () => of(null) } },
        { provide: AvatarUrlService, useValue: { url: () => null } },
        {
          provide: CustomerDirectoryStore,
          useValue: { byId: () => of(new Map()), search: () => of({ items: [] }), recent: () => [], addRecent: vi.fn() },
        },
        {
          provide: CorrespondenceCapabilities,
          useValue: {
            canRead: () => true,
            canCompose: () => true,
            canReply: () => true,
            canSend: () => true,
            canDownloadAttachments: () => true,
            canManage: () => true,
            canUnblockAddresses: () => false,
          },
        },
      ],
    });
    harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/email', MailPageComponent);
    harness.detectChanges();
    await settle();
    return component;
  }

  async function settle(): Promise<void> {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  const root = () => harness.routeNativeElement as HTMLElement;
  const input = () => root().querySelector('input[role="combobox"]') as HTMLInputElement;
  const tabs = () => Array.from(root().querySelectorAll('[role="tab"]')) as HTMLButtonElement[];
  const submit = async (text: string) => {
    input().value = text;
    input().dispatchEvent(new Event('input'));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
  };
  const url = () => TestBed.inject(Router).url;

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => {
    document.body.querySelectorAll('[role="dialog"], .dm-panel').forEach((el) => el.remove());
    localStorage.clear();
  });

  it('Enter con operadores: chips From/In, el texto libre queda en `q`, URL y búsqueda reciente', async () => {
    await setup();
    await submit('from:"ana@x.com" in:sent factura');

    expect(search).toHaveBeenLastCalledWith('factura', 50, {
      from: 'ana@x.com',
      folder: 'Sent',
      groups: ['emails', 'files', 'people'],
    });
    expect(url()).toContain('from=ana@x.com');
    expect(url()).toContain('folder=sent');
    expect(root().textContent).toContain('From: ana@x.com');
    expect(root().textContent).toContain('In: Sent');
    expect(input().value).toBe('factura');
    expect(TestBed.inject(MailStore).resultsMode()).toBe(true);
    expect(JSON.parse(localStorage.getItem('crm.mailRecentSearches.t1.u1')!)).toEqual(['from:ana@x.com in:sent factura']);
  });

  it('pestañas All · Emails · People · Files con rol tab; All muestra 3 personas, correos y 3 archivos con "See all"', async () => {
    await setup();
    await submit('factura');

    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual(['All', 'Emails · 2', 'People · 4', 'Files · 4']);
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[0].getAttribute('aria-controls')).toBe('mail-search-results');
    expect(root().querySelector('#mail-search-results')?.getAttribute('role')).toBe('tabpanel');

    const people = root().querySelector('[aria-labelledby="mail-all-people"]') as HTMLElement;
    expect(people.querySelectorAll('li').length).toBe(3);
    const files = root().querySelector('[aria-labelledby="mail-all-files"]') as HTMLElement;
    expect(files.querySelectorAll('li').length).toBe(3);
    expect(root().textContent).toContain('Factura octubre');

    // "See all" de personas salta a su pestaña sin volver a pedir (el grupo ya vino).
    const calls = search.mock.calls.length;
    (Array.from(people.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'See all') as HTMLButtonElement).click();
    await settle();
    expect(TestBed.inject(MailStore).searchTab()).toBe('people');
    expect(url()).toContain('tab=people');
    expect(search.mock.calls.length).toBe(calls);
    expect(root().querySelectorAll('app-mail-people-list li').length).toBe(4);
  });

  it('pestaña People: la fila filtra From (chip) y busca; la insignia Client sale si es cliente', async () => {
    await setup();
    await submit('factura');
    tabs()[2].click();
    await settle();
    const rows = Array.from(root().querySelectorAll('app-mail-people-list li')) as HTMLElement[];
    expect(rows[1].textContent).toContain('Client');
    expect(rows[0].textContent).not.toContain('Client');

    (rows[0].querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(search).toHaveBeenLastCalledWith('', 50, { from: 'ana@x.com', groups: ['emails', 'files', 'people'] });
    expect(root().textContent).toContain('From: ana@x.com');
    expect(TestBed.inject(MailStore).searchTab()).toBe('all');
  });

  it('elegir una persona sugerida pone el chip From y quitarlo con su X vuelve a buscar sin él', async () => {
    const component = await setup();
    component.onSearchPick({ groupId: 'people', item: { id: 'p', label: 'Ana', data: { kind: 'person', person: person() } } });
    await settle();
    expect(root().textContent).toContain('From: ana@x.com');

    await submit('factura');
    (root().querySelector('[aria-label="Remove From: ana@x.com"]') as HTMLButtonElement).click();
    await settle();
    expect(root().textContent).not.toContain('From: ana@x.com');
    expect(search).toHaveBeenLastCalledWith('factura', 50, { groups: ['emails', 'files', 'people'] });
  });

  it('búsquedas recientes en el desplegable vacío: elegir una la repite; quitar una y "Clear"', async () => {
    const component = await setup();
    await submit('factura');
    await submit('from:bob@y.com');
    expect(component.idleGroups()[0]).toMatchObject({ id: 'recent-searches', label: 'Recent searches', action: 'Clear' });
    expect(component.idleGroups()[0].items.map((item) => item.label)).toEqual(['from:bob@y.com', 'factura']);

    component.onSearchPick({ groupId: 'recent-searches', item: component.idleGroups()[0].items[1] });
    await settle();
    expect(search).toHaveBeenLastCalledWith('factura', 50, { groups: ['emails', 'files', 'people'] });
    expect(root().textContent).not.toContain('From: bob@y.com');

    component.onSuggestionRemoved({ groupId: 'recent-searches', item: component.idleGroups()[0].items[0] });
    expect(component.idleGroups()[0].items.map((item) => item.label)).toEqual(['from:bob@y.com']);
    component.onSuggestionGroupAction('recent-searches');
    expect(component.idleGroups().some((group) => group.id === 'recent-searches')).toBe(false);
  });

  it('panel de filtros: el ícono lo abre portado al body; "Search" aplica Subject, carpeta y rango', async () => {
    await setup();
    const trigger = root().querySelector('[aria-label="Search filters"]') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    trigger.click();
    await settle();
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(root().contains(dialog)).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const byLabel = (label: string) => {
      const el = Array.from(dialog.querySelectorAll('label')).find((l) => l.textContent?.trim() === label)!;
      return dialog.querySelector(`#${el.getAttribute('for')}`) as HTMLInputElement | HTMLSelectElement;
    };
    (byLabel('Subject') as HTMLInputElement).value = 'w-2';
    byLabel('Subject').dispatchEvent(new Event('input'));
    (byLabel('Folder') as HTMLSelectElement).value = 'inbox';
    byLabel('Folder').dispatchEvent(new Event('change'));
    (byLabel('Date') as HTMLSelectElement).value = '7d';
    byLabel('Date').dispatchEvent(new Event('change'));
    harness.detectChanges();
    (Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Search') as HTMLButtonElement).click();
    await settle();

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    const [, , filters] = search.mock.calls.at(-1)!;
    expect(search.mock.calls.at(-1)![0]).toBe('');
    expect(filters).toMatchObject({ subject: 'w-2', folder: 'Inbox', groups: ['emails', 'files', 'people'] });
    expect(filters.fromUtc).toBeTruthy();
    expect(root().textContent).toContain('Subject: w-2');
    expect(root().textContent).toContain('In: Inbox');
    expect(root().querySelector('[aria-label="Search filters, 3 active"]')).toBeTruthy();
  });

  it('un backend sin `people` deja la pestaña People vacía con su texto, sin romper All', async () => {
    await setup();
    result = { emails: [email()], files: [] };
    await submit('factura');
    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual(['All', 'Emails · 1', 'People · 0', 'Files · 0']);
    expect(root().querySelector('[aria-labelledby="mail-all-people"]')).toBeNull();
    tabs()[2].click();
    await settle();
    expect(root().textContent).toContain('No people match "factura"');
  });

  it('elegir una carpeta del rail sale de los resultados y quita los filtros de campo', async () => {
    const component = await setup();
    await submit('from:ana@x.com factura');
    component.selectFolder('sent');
    await settle();
    const store = TestBed.inject(MailStore);
    expect(store.resultsMode()).toBe(false);
    expect(store.fromFilter()).toBe('');
    expect(store.query()).toBe('factura');
    expect(url()).toContain('in=sent');
    expect(url()).not.toContain('from=');
  });
});
