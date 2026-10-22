import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { EmailActivityDetail, EmailActivityItem, EmailActivityPage } from '@core/postmaster/email-activity.model';
import { EmailActivityQuery, EmailActivityService } from '@core/postmaster/email-activity.service';
import { EMAIL_ACTIVITY_PAGE_SIZE, EmailActivityStore } from './email-activity.store';

const item = (id: string, status: EmailActivityItem['status'] = 'Delivered'): EmailActivityItem => ({
  id,
  subject: 'Your documents are ready',
  recipients: ['c***@client.com'],
  lane: 'SystemProvider',
  status,
  queuedAtUtc: '2026-10-21T12:00:00',
  sentAtUtc: '2026-10-21T12:00:01',
  lastEventAtUtc: null,
  opened: false,
  clicked: false,
});

const page = (items: EmailActivityItem[], totalCount = items.length): EmailActivityPage => ({
  items,
  page: 1,
  size: EMAIL_ACTIVITY_PAGE_SIZE,
  totalCount,
});

describe('EmailActivityStore', () => {
  let store: EmailActivityStore;
  let service: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    service = { list: vi.fn(() => of(page([item('m1')]))), get: vi.fn() };
    TestBed.configureTestingModule({
      providers: [EmailActivityStore, { provide: EmailActivityService, useValue: service }],
    });
    store = TestBed.inject(EmailActivityStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('carga la primera página con el total del servidor', () => {
    service.list.mockReturnValue(of(page([item('m1'), item('m2')], 40)));

    store.load();

    expect(store.items().map(i => i.id)).toEqual(['m1', 'm2']);
    expect(store.total()).toBe(40);
    expect(store.loading()).toBe(false);
    expect(service.list).toHaveBeenCalledWith({ status: 'All', recipient: '', page: 1, size: EMAIL_ACTIVITY_PAGE_SIZE });
  });

  it('cambiar el filtro vuelve a la página 1', () => {
    store.setPage(3);

    store.setStatus('Bounced');

    const last = service.list.mock.calls.at(-1)![0] as EmailActivityQuery;
    expect(last).toMatchObject({ status: 'Bounced', page: 1 });
    expect(store.page()).toBe(1);
  });

  it('buscar por destinatario vuelve a la página 1 y no repite la búsqueda igual', () => {
    store.setPage(2);
    store.setRecipient('maria');
    store.setRecipient('maria');

    expect(service.list.mock.calls.filter(c => (c[0] as EmailActivityQuery).recipient === 'maria')).toHaveLength(1);
    expect(store.page()).toBe(1);
  });

  it('una respuesta vieja no pisa la del filtro actual', () => {
    const slow = new Subject<EmailActivityPage>();
    const fast = new Subject<EmailActivityPage>();
    service.list.mockReturnValueOnce(slow).mockReturnValueOnce(fast);

    store.setStatus('Delivered');
    store.setStatus('Bounced');
    fast.next(page([item('bounced', 'Bounced')]));
    slow.next(page([item('delivered')]));

    expect(store.items().map(i => i.id)).toEqual(['bounced']);
  });

  it('muestra el error del backend', () => {
    service.list.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    store.load();

    expect(store.error()).toBeTruthy();
    expect(store.loading()).toBe(false);
  });

  it('abre el detalle y al cerrar ignora una respuesta que llega tarde', () => {
    const response = new Subject<EmailActivityDetail>();
    service.get.mockReturnValue(response);

    store.open('m1');
    expect(store.detailOpen()).toBe(true);
    expect(store.detailLoading()).toBe(true);

    store.close();
    response.next({ id: 'm1' } as EmailActivityDetail);

    expect(store.detailOpen()).toBe(false);
    expect(store.detail()).toBeNull();
  });
});
