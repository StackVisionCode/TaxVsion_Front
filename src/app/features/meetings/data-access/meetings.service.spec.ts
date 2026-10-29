import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { READ_ONLY_REQUEST } from '@core/http/read-only-request';
import { MeetingsService } from './meetings.service';

/**
 * El término del directorio de clientes (a menudo un email) nunca viaja en la URL: va en el cuerpo
 * de POST /communication/directory/customers/search, que acaba fuera de los logs del Gateway.
 */
describe('MeetingsService · searchCustomers', () => {
  const URL = 'https://api.test/communication/directory/customers/search';

  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ApiConfigService,
          useValue: { tenantUrl: (path: string) => `https://api.test${path}` },
        },
      ],
    });
    return {
      service: TestBed.inject(MeetingsService),
      http: TestBed.inject(HttpTestingController),
    };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('hace POST con el término y el límite en el cuerpo, sin query string', () => {
    const { service, http } = setup();

    service.searchCustomers('ana@example.com', 5).subscribe();

    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.urlWithParams).toBe(URL);
    expect(req.request.body).toEqual({ q: 'ana@example.com', limit: 5 });
    // Solo lectura: conserva el reintento silencioso ante 429/503 que tenía el GET.
    expect(req.request.context.get(READ_ONLY_REQUEST)).toBe(true);
    req.flush([]);
    http.verify();
  });

  it('usa el límite por defecto de 8', () => {
    const { service, http } = setup();

    service.searchCustomers('ana').subscribe();

    const req = http.expectOne(URL);
    expect(req.request.body).toEqual({ q: 'ana', limit: 8 });
    req.flush([]);
    http.verify();
  });
});
