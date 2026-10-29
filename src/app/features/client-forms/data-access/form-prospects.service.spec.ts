import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { FormProspectsService } from './form-prospects.service';

describe('FormProspectsService', () => {
  let service: FormProspectsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `/api${path}` } },
      ],
    });
    service = TestBed.inject(FormProspectsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists with page and size, and only the filters that are set', () => {
    service.list({ status: 'Lost', search: ' ana ', page: 2, size: 25 }).subscribe();
    const filtered = http.expectOne((req) => req.url === '/api/tasks/forms/prospects');
    expect(filtered.request.params.get('status')).toBe('Lost');
    expect(filtered.request.params.get('search')).toBe('ana');
    expect(filtered.request.params.get('page')).toBe('2');
    expect(filtered.request.params.get('size')).toBe('25');
    filtered.flush({ items: [], page: 2, size: 25, totalCount: 0 });

    service.list({ status: null, search: '', page: 1, size: 25 }).subscribe();
    const plain = http.expectOne((req) => req.url === '/api/tasks/forms/prospects');
    expect(plain.request.params.has('status')).toBe(false);
    expect(plain.request.params.has('search')).toBe(false);
    plain.flush({ items: [], page: 1, size: 25, totalCount: 0 });
  });

  it('posts lost with the reason and reopen with an empty body', () => {
    service.markLost('p-1', null).subscribe();
    const lost = http.expectOne('/api/tasks/forms/prospects/p-1/lost');
    expect(lost.request.method).toBe('POST');
    expect(lost.request.body).toEqual({ reason: null });
    lost.flush({});

    service.reopen('p-1').subscribe();
    const reopen = http.expectOne('/api/tasks/forms/prospects/p-1/reopen');
    expect(reopen.request.method).toBe('POST');
    reopen.flush({});
  });
});
