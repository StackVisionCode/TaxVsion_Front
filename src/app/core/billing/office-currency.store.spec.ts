import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AccessStore } from '@core/access/access.store';
import { ApiConfigService } from '@core/config/api-config.service';
import { FALLBACK_OFFICE_CURRENCY, OfficeCurrencyStore } from './office-currency.store';

/**
 * El store solo LEE el permission (`invoicing.view`): sin él no se pega al API y queda el fallback.
 * Billing le empuja la moneda cuando carga/guarda el perfil, y eso evita el GET.
 */
describe('OfficeCurrencyStore', () => {
  const URL = 'https://demo.example.com/api/billing/issuer-profile';

  function setup(permissions: string[] = ['invoicing.view']) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AccessStore,
          useValue: { ready: () => Promise.resolve(), can: (p: string) => permissions.includes(p) },
        },
        { provide: ApiConfigService, useValue: { tenantBase: () => 'https://demo.example.com/api' } },
      ],
    });
    return {
      store: TestBed.inject(OfficeCurrencyStore),
      http: TestBed.inject(HttpTestingController),
    };
  }

  /** Deja correr el `await access.ready()` antes de buscar la petición. */
  const flushMicrotasks = () => new Promise<void>(resolve => setTimeout(resolve));

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('arranca en USD', () => {
    const { store } = setup();
    expect(store.currency()).toBe(FALLBACK_OFFICE_CURRENCY);
  });

  it('con invoicing.view lee la moneda del perfil del emisor una sola vez', async () => {
    const { store, http } = setup();

    const first = store.ensureLoaded();
    const second = store.ensureLoaded();
    await flushMicrotasks();
    http.expectOne(URL).flush({ name: 'Firm', defaultCurrency: 'eur' });
    await Promise.all([first, second]);

    expect(store.currency()).toBe('EUR');

    await store.ensureLoaded();
    http.expectNone(URL);
  });

  it('sin invoicing.view no pide nada y se queda en el fallback', async () => {
    const { store, http } = setup([]);

    await store.ensureLoaded();

    http.expectNone(URL);
    expect(store.currency()).toBe('USD');
  });

  it('lo que empuja billing evita el GET', async () => {
    const { store, http } = setup();

    store.set('DOP');
    await store.ensureLoaded();

    http.expectNone(URL);
    expect(store.currency()).toBe('DOP');
  });

  it('ignora códigos inválidos y un error del API deja el fallback', async () => {
    const { store, http } = setup();

    store.set('');
    store.set('dollars');
    expect(store.currency()).toBe('USD');

    const pending = store.ensureLoaded();
    await flushMicrotasks();
    http.expectOne(URL).flush('boom', { status: 500, statusText: 'Server Error' });
    await pending;

    expect(store.currency()).toBe('USD');
  });
});
