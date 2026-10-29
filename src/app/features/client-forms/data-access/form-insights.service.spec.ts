import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { FormInsightsService } from './form-insights.service';

describe('FormInsightsService', () => {
  let service: FormInsightsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `/api${path}` } },
      ],
    });
    service = TestBed.inject(FormInsightsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asks for the summary with period, offset and the template only when set', () => {
    service.summary(90, 't-1', -300).subscribe();
    const filtered = http.expectOne((req) => req.url === '/api/tasks/forms/insights/summary');
    expect(filtered.request.params.get('period')).toBe('90');
    expect(filtered.request.params.get('utcOffsetMinutes')).toBe('-300');
    expect(filtered.request.params.get('templateId')).toBe('t-1');
    filtered.flush({});

    service.summary(30, null, 0).subscribe();
    const plain = http.expectOne((req) => req.url === '/api/tasks/forms/insights/summary');
    expect(plain.request.params.has('templateId')).toBe(false);
    plain.flush({});
  });

  it('pages the template breakdown', () => {
    service.templates(7, 2, 10, 60).subscribe();
    const request = http.expectOne((req) => req.url === '/api/tasks/forms/insights/templates');
    expect(request.request.params.get('period')).toBe('7');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('size')).toBe('10');
    expect(request.request.params.get('utcOffsetMinutes')).toBe('60');
    request.flush({ items: [], page: 2, size: 10, totalCount: 0 });
  });
});
