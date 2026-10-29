import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import type { NoteResponse } from './client-notes.model';
import { ClientNotesService } from './client-notes.service';

describe('ClientNotesService.listAllByClient', () => {
  let service: ClientNotesService;
  let http: HttpTestingController;
  const note = (id: string) => ({ id }) as NoteResponse;
  const page = (n: number, items: NoteResponse[], hasMore: boolean) => ({
    items,
    page: n,
    size: 100,
    totalCount: 101,
    totalPages: 2,
    hasMore,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `https://api.test${path}` } },
      ],
    });
    service = TestBed.inject(ClientNotesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // Antes solo llegaba la primera página de 100 notas.
  it('follows hasMore until every page is loaded', () => {
    let result: NoteResponse[] = [];
    service.listAllByClient('client-1').subscribe(items => (result = items));

    http
      .expectOne(req => req.params.get('page') === '1')
      .flush(page(1, Array.from({ length: 100 }, (_, i) => note(`a${i}`)), true));
    http.expectOne(req => req.params.get('page') === '2').flush(page(2, [note('b0')], false));

    expect(result).toHaveLength(101);
    expect(result.at(-1)?.id).toBe('b0');
  });

  it('stops after the first page when there is nothing more', () => {
    let result: NoteResponse[] = [];
    service.listAllByClient('client-1').subscribe(items => (result = items));

    http.expectOne(() => true).flush(page(1, [note('a')], false));

    expect(result.map(item => item.id)).toEqual(['a']);
  });
});
