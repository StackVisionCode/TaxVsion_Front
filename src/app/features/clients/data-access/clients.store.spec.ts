import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { ClientsStore } from './clients.store';
import { ClientsService } from './clients.service';
import { CustomerSummary, PagedResult } from './clients.model';

/**
 * Listado de Clients: filtro por tipo y orden viajan al backend, y cualquier cambio vuelve a la
 * página 1 (la página N de otro filtro u orden son otros clientes).
 */
describe('ClientsStore · tipo, orden y paginación', () => {
  const BASE = 'https://api.test/customers';

  function page(pageNumber: number, totalCount: number, items: CustomerSummary[] = []): PagedResult<CustomerSummary> {
    return {
      items,
      page: pageNumber,
      size: 25,
      totalCount,
      totalPages: Math.ceil(totalCount / 25),
      hasMore: false,
      hasPrevious: pageNumber > 1,
    };
  }

  const ROW = {
    id: 'c1',
    kind: 'Business',
    status: 'Active',
    displayName: 'Anchor Builders',
    primaryEmail: 'contact@anchor.example.com',
    primaryPhone: null,
    createdAtUtc: '2026-07-15T00:00:00Z',
  } as CustomerSummary;

  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ClientsService,
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `https://api.test${path}` } },
      ],
    });
    return { store: TestBed.inject(ClientsStore), http: TestBed.inject(HttpTestingController) };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('por defecto no manda tipo y ordena por nombre A–Z', () => {
    const { store, http } = setup();

    store.initList({});

    const req = http.expectOne(r => r.url === BASE);
    expect(req.request.params.has('kind')).toBe(false);
    expect(req.request.params.get('sort')).toBe('Name');
    expect(req.request.params.get('dir')).toBe('Asc');
    req.flush(page(1, 1, [ROW]));
  });

  it('elegir un tipo lo manda y vuelve a la página 1', () => {
    const { store, http } = setup();
    store.initList({ page: 3 });
    http.expectOne(r => r.url === BASE).flush(page(3, 80, [ROW]));

    store.setKind('Business');

    const req = http.expectOne(r => r.url === BASE);
    expect(req.request.params.get('kind')).toBe('Business');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(page(1, 1, [ROW]));
    expect(store.page()).toBe(1);
  });

  it('"All types" deja de mandar el tipo', () => {
    const { store, http } = setup();
    store.initList({ kind: 'Individual' });
    http.expectOne(r => r.url === BASE).flush(page(1, 1, [ROW]));

    store.setKind('All');

    const req = http.expectOne(r => r.url === BASE);
    expect(req.request.params.has('kind')).toBe(false);
    req.flush(page(1, 1, [ROW]));
  });

  it('cambiar el orden lo manda y vuelve a la página 1', () => {
    const { store, http } = setup();
    store.initList({ page: 2 });
    http.expectOne(r => r.url === BASE).flush(page(2, 60, [ROW]));

    store.setSort({ field: 'Created', dir: 'Desc' });

    const req = http.expectOne(r => r.url === BASE);
    expect(req.request.params.get('sort')).toBe('Created');
    expect(req.request.params.get('dir')).toBe('Desc');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(page(1, 60, [ROW]));
  });

  it('una página que quedó fuera de rango salta a la última con clientes', () => {
    const { store, http } = setup();
    store.initList({ page: 4 });

    // Se archivó lo último de la página 4: quedan 75 clientes = 3 páginas.
    http.expectOne(r => r.url === BASE && r.params.get('page') === '4').flush(page(4, 75));

    const retry = http.expectOne(r => r.url === BASE);
    expect(retry.request.params.get('page')).toBe('3');
    retry.flush(page(3, 75, [ROW]));
    expect(store.page()).toBe(3);
    expect(store.items().length).toBe(1);
  });

  it('limpiar filtros quita búsqueda, estado y tipo en una sola petición, sin tocar el orden', () => {
    const { store, http } = setup();
    store.initList({ term: 'anchor', status: 'Archived', kind: 'Business', sort: { field: 'Created', dir: 'Desc' } });
    http.expectOne(r => r.url === BASE).flush(page(1, 0));

    store.resetFilters();

    const req = http.expectOne(r => r.url === BASE);
    expect(req.request.params.has('term')).toBe(false);
    expect(req.request.params.get('status')).toBe('NotArchived');
    expect(req.request.params.has('kind')).toBe(false);
    expect(req.request.params.get('sort')).toBe('Created');
    req.flush(page(1, 1, [ROW]));
    http.verify();
  });
});
