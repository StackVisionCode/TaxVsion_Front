import { TestBed } from '@angular/core/testing';
import { EMPTY, Observable, Subject, of } from 'rxjs';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { CustomerDirectoryService } from './customer-directory.service';
import { CustomerDirectoryStore } from './customer-directory.store';
import { CustomerSearchParams, CustomerSummary, PagedResult } from './customer-summary.model';

/** Stub del socket compartido: no emite eventos durante los tests del cache. */
class FakeRealtime {
  readonly reconnected$ = new Subject<void>();
  on<T>(): Observable<T> {
    return EMPTY;
  }
}

function customer(id: string, name = `Customer ${id}`): CustomerSummary {
  return {
    id,
    kind: 'Individual',
    status: 'Active',
    displayName: name,
    primaryEmail: `${id}@example.com`,
    primaryPhone: null,
    createdAtUtc: '2026-01-01T00:00:00Z',
  };
}

function page(items: CustomerSummary[]): PagedResult<CustomerSummary> {
  return { items, page: 1, size: 20, totalCount: items.length, totalPages: 1, hasMore: false, hasPrevious: false };
}

class FakeCustomerDirectoryService {
  searchCalls = 0;
  byIdCalls: string[] = [];
  nextPage: PagedResult<CustomerSummary> = page([customer('1')]);
  deferred = false;
  readonly deferredSubject = new Subject<PagedResult<CustomerSummary>>();

  search(_params: CustomerSearchParams): Observable<PagedResult<CustomerSummary>> {
    this.searchCalls++;
    return this.deferred ? this.deferredSubject.asObservable() : of(this.nextPage);
  }

  getById(id: string): Observable<CustomerSummary> {
    this.byIdCalls.push(id);
    return of(customer(id));
  }
}

describe('CustomerDirectoryStore', () => {
  let store: CustomerDirectoryStore;
  let service: FakeCustomerDirectoryService;

  beforeEach(() => {
    localStorage.removeItem('crm.recentCustomers');
    service = new FakeCustomerDirectoryService();
    TestBed.configureTestingModule({
      providers: [
        CustomerDirectoryStore,
        { provide: CustomerDirectoryService, useValue: service },
        { provide: CommunicationRealtimeService, useClass: FakeRealtime },
      ],
    });
    store = TestBed.inject(CustomerDirectoryStore);
  });

  it('cachea la búsqueda por clave: la misma consulta no vuelve a la red dentro del TTL', () => {
    store.search({ term: 'ann', status: 'NotArchived' }).subscribe();
    store.search({ term: 'ann', status: 'NotArchived' }).subscribe();
    expect(service.searchCalls).toBe(1);
  });

  it('una clave distinta sí vuelve a consultar', () => {
    store.search({ term: 'ann' }).subscribe();
    store.search({ term: 'bob' }).subscribe();
    expect(service.searchCalls).toBe(2);
  });

  it('invalidate() fuerza re-consultar', () => {
    store.search({ term: 'ann' }).subscribe();
    store.invalidate();
    store.search({ term: 'ann' }).subscribe();
    expect(service.searchCalls).toBe(2);
  });

  it('deduplica peticiones en vuelo: dos suscriptores comparten una sola llamada', () => {
    service.deferred = true;
    const seen: number[] = [];
    store.search({ term: 'ann' }).subscribe(p => seen.push(p.items.length));
    store.search({ term: 'ann' }).subscribe(p => seen.push(p.items.length));
    expect(service.searchCalls).toBe(1);

    service.deferredSubject.next(page([customer('1'), customer('2')]));
    service.deferredSubject.complete();
    expect(seen).toEqual([2, 2]);
  });

  it('byId se sirve del cache poblado por search (sin getById extra)', () => {
    service.nextPage = page([customer('1', 'Ann'), customer('2', 'Bob')]);
    store.search({ term: 'a' }).subscribe();

    let map: Map<string, CustomerSummary> | undefined;
    store.byId(['1', '2']).subscribe(m => (map = m)); // of() emite síncrono
    expect(map?.get('1')?.displayName).toBe('Ann');
    expect(map?.get('2')?.displayName).toBe('Bob');
    expect(service.byIdCalls.length).toBe(0);
  });

  it('byId pide individualmente los faltantes', () => {
    let map: Map<string, CustomerSummary> | undefined;
    store.byId(['99']).subscribe(m => (map = m));
    expect(map?.get('99')?.id).toBe('99');
    expect(service.byIdCalls).toEqual(['99']);
  });

  it('addRecent: dedup por id al tope y persiste', () => {
    store.addRecent(customer('1', 'Ann'));
    store.addRecent(customer('2', 'Bob'));
    store.addRecent(customer('1', 'Ann')); // vuelve al tope, sin duplicar
    expect(store.recent().map(c => c.id)).toEqual(['1', '2']);
    expect(JSON.parse(localStorage.getItem('crm.recentCustomers')!).length).toBe(2);
  });
});
