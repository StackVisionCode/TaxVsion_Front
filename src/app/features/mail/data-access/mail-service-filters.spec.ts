import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MailService } from './mail.service';
import { ApiConfigService } from '@core/config/api-config.service';

// Chips → query params de Correspondence: todo en el servidor y nunca `unlinked` junto a `customerId`.
describe('MailService: filtros de servidor y reenvío', () => {
  let service: MailService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ApiConfigService,
          useValue: { tenantUrl: (path: string) => `https://api${path}` },
        },
      ],
    });
    service = TestBed.inject(MailService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Query string de la única petición pendiente, ordenada para comparar. */
  const params = (path: string): Record<string, string> => {
    const req = http.expectOne((r) => r.url === `https://api/correspondence${path}`);
    const out: Record<string, string> = {};
    req.request.params.keys().forEach((key) => (out[key] = req.request.params.get(key)!));
    req.flush({});
    return out;
  };

  it('/threads: todos los chips como parámetros; los vacíos no viajan', () => {
    service
      .listInboxThreads(
        {
          unlinked: true,
          unreadOnly: true,
          hasAttachments: true,
          fromUtc: '2026-10-04T12:00:00.000Z',
          search: ' w-2 ',
        },
        1,
        50,
      )
      .subscribe();
    expect(params('/threads')).toEqual({
      status: 'all',
      page: '1',
      size: '50',
      unlinked: 'true',
      unreadOnly: 'true',
      hasAttachments: 'true',
      fromUtc: '2026-10-04T12:00:00.000Z',
      q: 'w-2',
    });

    service
      .listInboxThreads({ search: '', hasAttachments: false, fromUtc: null }, 1, 50)
      .subscribe();
    expect(params('/threads')).toEqual({ status: 'all', page: '1', size: '50' });
  });

  it('/threads y /search: con cliente nunca se manda `unlinked` (400 CustomerFilterConflict)', () => {
    service.listInboxThreads({ customerId: 'c1', unlinked: true }, 1, 50).subscribe();
    const threads = params('/threads');
    expect(threads['customerId']).toBe('c1');
    expect(threads['unlinked']).toBeUndefined();

    service.search('factura', 50, { customerId: 'c1', unlinked: true }).subscribe();
    const search = params('/search');
    expect(search['customerId']).toBe('c1');
    expect(search['unlinked']).toBeUndefined();
  });

  it('/search: chips de correos y rango; sin chips solo q y limit', () => {
    service
      .search(' factura ', 50, {
        unlinked: true,
        hasAttachments: true,
        unreadOnly: true,
        fromUtc: '2026-10-27T00:00:00.000Z',
      })
      .subscribe();
    expect(params('/search')).toEqual({
      q: 'factura',
      limit: '50',
      unlinked: 'true',
      hasAttachments: 'true',
      unreadOnly: 'true',
      fromUtc: '2026-10-27T00:00:00.000Z',
    });

    service.search('factura', 5).subscribe();
    expect(params('/search')).toEqual({ q: 'factura', limit: '5' });
  });

  it('/search ampliado (B1): campos, carpeta, rango cerrado y solo los grupos pedidos; q vacío no viaja', () => {
    service
      .search('', 50, {
        from: ' ana@x.com ',
        to: 'bob',
        subject: 'w-2',
        folder: 'Sent',
        fromUtc: '2026-10-01T04:00:00.000Z',
        toUtc: '2026-11-01T03:59:59.999Z',
        groups: ['emails', 'people'],
      })
      .subscribe();
    expect(params('/search')).toEqual({
      limit: '50',
      from: 'ana@x.com',
      to: 'bob',
      subject: 'w-2',
      folder: 'Sent',
      fromUtc: '2026-10-01T04:00:00.000Z',
      toUtc: '2026-11-01T03:59:59.999Z',
      groups: 'emails,people',
    });

    // Campos vacíos y lista de grupos vacía no viajan.
    service.search('factura', 5, { from: '  ', subject: null, folder: null, groups: [] }).subscribe();
    expect(params('/search')).toEqual({ q: 'factura', limit: '5' });
  });

  it('/threads: `toUtc` del rango personalizado viaja', () => {
    service.listInboxThreads({ toUtc: '2026-11-01T03:59:59.999Z' }, 1, 50).subscribe();
    expect(params('/threads')['toUtc']).toBe('2026-11-01T03:59:59.999Z');
  });

  it('Sent/Drafts/Trash: alcance + q, adjuntos y fecha (Drafts también filtra por adjuntos)', () => {
    const filters = { q: 'factura', hasAttachments: true, fromUtc: '2026-10-04T12:00:00.000Z' };
    service.listDrafts({ kind: 'unlinked' }, 1, 50, filters).subscribe();
    expect(params('/drafts')).toEqual({
      unlinked: 'true',
      q: 'factura',
      hasAttachments: 'true',
      fromUtc: '2026-10-04T12:00:00.000Z',
      page: '1',
      size: '50',
    });

    service
      .listSent({ kind: 'customer', customerId: 'c1' }, 2, 50, { hasAttachments: true })
      .subscribe();
    expect(params('/sent')).toEqual({
      customerId: 'c1',
      hasAttachments: 'true',
      page: '2',
      size: '50',
    });

    service.listTrash({ kind: 'all' }, 1, 50).subscribe();
    expect(params('/trash')).toEqual({ scope: 'all', page: '1', size: '50' });
  });

  it('resend: POST con cuerpo vacío o con la dirección corregida', () => {
    const drafts: string[] = [];
    service.resendDeliveryNotice('n1').subscribe((result) => drafts.push(result.draftId));
    let req = http.expectOne('https://api/correspondence/delivery-notices/n1/resend');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ draftId: 'd1' });

    service
      .resendDeliveryNotice('n1', '  maria@x.com ')
      .subscribe((result) => drafts.push(result.draftId));
    req = http.expectOne('https://api/correspondence/delivery-notices/n1/resend');
    expect(req.request.body).toEqual({ recipient: 'maria@x.com' });
    req.flush({ draftId: 'd2' });

    expect(drafts).toEqual(['d1', 'd2']);
  });
});
