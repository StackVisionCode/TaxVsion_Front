import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { READ_ONLY_REQUEST } from '@core/http/read-only-request';
import { CustomerDirectoryService } from './customer-directory.service';
import { CustomerSummary, PagedResult } from './customer-summary.model';

/**
 * El término de búsqueda (a menudo un email) nunca viaja en la URL: con término se usa
 * POST /customers/search; sin término, el GET de siempre (revalidación 304 del navegador).
 */
describe('CustomerDirectoryService · search', () => {
  const BASE = 'https://api.test/customers';
  const EMPTY: PagedResult<CustomerSummary> = {
    items: [],
    page: 1,
    size: 20,
    totalCount: 0,
    totalPages: 0,
    hasMore: false,
    hasPrevious: false,
  };

  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `https://api.test${path}` } },
      ],
    });
    return { service: TestBed.inject(CustomerDirectoryService), http: TestBed.inject(HttpTestingController) };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('con término hace POST /customers/search con término, estado y paginación en el cuerpo', () => {
    const { service, http } = setup();

    service.search({ term: '  ana@example.com ', status: 'NotArchived', page: 2, size: 20 }).subscribe();

    const req = http.expectOne(`${BASE}/search`);
    expect(req.request.method).toBe('POST');
    expect(req.request.urlWithParams).toBe(`${BASE}/search`);
    expect(req.request.body).toEqual({ term: 'ana@example.com', status: 'NotArchived', page: 2, size: 20 });
    // Solo lectura: conserva el reintento silencioso ante 429/503 que tenía el GET.
    expect(req.request.context.get(READ_ONLY_REQUEST)).toBe(true);
    req.flush(EMPTY);
    http.verify();
  });

  it('sin término (o solo espacios) lista por GET /customers sin parámetro term', () => {
    const { service, http } = setup();

    service.search({ term: '   ', status: 'Active', page: 1, size: 20 }).subscribe();

    const req = http.expectOne(r => r.url === BASE);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.has('term')).toBe(false);
    expect(req.request.params.get('status')).toBe('Active');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('size')).toBe('20');
    req.flush(EMPTY);
    http.verify();
  });

  it('los filtros que no se pasan no viajan en el cuerpo (el backend aplica sus defaults)', () => {
    const { service, http } = setup();

    service.search({ term: 'ana' }).subscribe();

    const req = http.expectOne(`${BASE}/search`);
    expect(JSON.parse(JSON.stringify(req.request.body))).toEqual({ term: 'ana' });
    req.flush(EMPTY);
    http.verify();
  });
});
