import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { READ_ONLY_REQUEST } from '@core/http/read-only-request';
import { SmsService } from './sms.service';

/**
 * El término de búsqueda (nombre, teléfono o email del cliente) nunca viaja en la URL: con término se
 * usa POST .../search; sin término, el GET de siempre.
 */
describe('SmsService · búsquedas', () => {
  const API = 'https://api.test';
  const EMPTY = { items: [], page: 1, size: 20, totalCount: 0 };

  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `${API}${path}` } },
      ],
    });
    return { service: TestBed.inject(SmsService), http: TestBed.inject(HttpTestingController) };
  }

  afterEach(() => TestBed.resetTestingModule());

  describe('conversaciones', () => {
    it('con término hace POST /sms/conversations/search con término y paginación en el cuerpo', () => {
      const { service, http } = setup();

      service.listConversations({ term: '  +1 555 123 ', page: 2, size: 20 }).subscribe();

      const req = http.expectOne(`${API}/sms/conversations/search`);
      expect(req.request.method).toBe('POST');
      expect(req.request.urlWithParams).toBe(`${API}/sms/conversations/search`);
      expect(req.request.body).toEqual({ term: '+1 555 123', page: 2, size: 20 });
      // Solo lectura: conserva el reintento silencioso ante 429/503 que tenía el GET.
      expect(req.request.context.get(READ_ONLY_REQUEST)).toBe(true);
      req.flush(EMPTY);
      http.verify();
    });

    it('sin término (o solo espacios) lista por GET /sms/conversations sin parámetro term', () => {
      const { service, http } = setup();

      service.listConversations({ term: '   ', page: 3, size: 50 }).subscribe();

      const req = http.expectOne(r => r.url === `${API}/sms/conversations`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.has('term')).toBe(false);
      expect(req.request.params.get('page')).toBe('3');
      expect(req.request.params.get('size')).toBe('50');
      req.flush(EMPTY);
      http.verify();
    });
  });

  describe('mensajes', () => {
    it('con término hace POST /sms/messages/search con todos los filtros en el cuerpo', () => {
      const { service, http } = setup();

      service
        .listMessages({
          customerId: 'c-1',
          status: 'Failed',
          term: 'ana@example.com',
          from: '2026-01-01T00:00:00Z',
          to: '2026-01-08T00:00:00Z',
          page: 2,
          size: 25,
        })
        .subscribe();

      const req = http.expectOne(`${API}/sms/messages/search`);
      expect(req.request.method).toBe('POST');
      expect(req.request.urlWithParams).toBe(`${API}/sms/messages/search`);
      expect(req.request.body).toEqual({
        customerId: 'c-1',
        status: 'Failed',
        term: 'ana@example.com',
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-08T00:00:00Z',
        page: 2,
        size: 25,
      });
      expect(req.request.context.get(READ_ONLY_REQUEST)).toBe(true);
      req.flush(EMPTY);
      http.verify();
    });

    it('los filtros que no se pasan (o status All) no viajan en el cuerpo', () => {
      const { service, http } = setup();

      service.listMessages({ status: 'All', term: 'ana' }).subscribe();

      const req = http.expectOne(`${API}/sms/messages/search`);
      expect(JSON.parse(JSON.stringify(req.request.body))).toEqual({ term: 'ana' });
      req.flush(EMPTY);
      http.verify();
    });

    it('sin término lista por GET /sms/messages con sus query params de siempre', () => {
      const { service, http } = setup();

      service.listMessages({ customerId: 'c-1', status: 'Delivered', page: 1, size: 100 }).subscribe();

      const req = http.expectOne(r => r.url === `${API}/sms/messages`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.has('term')).toBe(false);
      expect(req.request.params.get('customerId')).toBe('c-1');
      expect(req.request.params.get('status')).toBe('Delivered');
      expect(req.request.params.get('page')).toBe('1');
      expect(req.request.params.get('size')).toBe('100');
      expect(req.request.context.get(READ_ONLY_REQUEST)).toBe(false);
      req.flush(EMPTY);
      http.verify();
    });
  });

  describe('bajas (opt-outs)', () => {
    it('con término hace POST /sms/optouts/search (no el POST /sms/optouts de consentimiento)', () => {
      const { service, http } = setup();

      service.listOptOuts({ status: 'OptedOut', term: 'Ana', page: 4, size: 50 }).subscribe();

      const req = http.expectOne(`${API}/sms/optouts/search`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ status: 'OptedOut', term: 'Ana', page: 4, size: 50 });
      expect(req.request.context.get(READ_ONLY_REQUEST)).toBe(true);
      req.flush(EMPTY);
      http.verify();
    });

    it('sin término lista por GET /sms/optouts sin parámetro term', () => {
      const { service, http } = setup();

      service.listOptOuts({ status: 'All', term: '', page: 2, size: 20 }).subscribe();

      const req = http.expectOne(r => r.url === `${API}/sms/optouts`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.has('term')).toBe(false);
      expect(req.request.params.has('status')).toBe(false);
      expect(req.request.params.get('page')).toBe('2');
      req.flush(EMPTY);
      http.verify();
    });
  });
});
