import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { firstValueFrom } from 'rxjs';
import { catalogResponse } from '../testing/mapping-catalog.fixture';
import { MappingCatalogService, toMappingCatalog } from './mapping-catalog.service';
import { MappingCatalogStore } from './mapping-catalog.store';

const URL = 'https://api.test/tasks/forms/mapping-catalog';

describe('MappingCatalogService', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        MappingCatalogStore,
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `https://api.test${path}` } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the catalog from the backend and converts the enums', async () => {
    const result = firstValueFrom(TestBed.inject(MappingCatalogService).get());
    http.expectOne(URL).flush(catalogResponse());
    const catalog = await result;
    const language = catalog.targets.find((item) => item.targetKey === 'customer.language');
    expect(language).toMatchObject({
      dataType: 'enum',
      sensitivity: 'general',
      status: 'active',
      enumValues: ['Es', 'En', 'Pt', 'Fr'],
      requiredPermissions: [],
      requiresTenantAdmin: false,
      compatibleComponentTypes: ['select', 'radio'],
    });
    expect(catalog.operations[0]).toMatchObject({
      name: 'CreateCustomer',
      configTargets: { kind: 'customer.kind', language: 'customer.language' },
    });
  });

  it('converts PascalCase types such as TaxId', () => {
    const response = catalogResponse();
    response.targets[0] = { ...response.targets[0], dataType: 'TaxId', sensitivity: 'Restricted' };
    const catalog = toMappingCatalog(response);
    expect(catalog.targets[0].dataType).toBe('taxId');
    expect(catalog.targets[0].sensitivity).toBe('restricted');
  });

  it('loads once in the store and reuses the catalog', async () => {
    const store = TestBed.inject(MappingCatalogStore);
    const first = store.load();
    const second = store.load();
    expect(store.loading()).toBe(true);
    http.expectOne(URL).flush(catalogResponse());
    await Promise.all([first, second]);
    expect(store.catalog()?.catalogVersion).toBe(1);
    await store.load();
    http.expectNone(URL);
  });

  it('exposes an error and retries on reload', async () => {
    const store = TestBed.inject(MappingCatalogStore);
    const failed = store.load();
    http.expectOne(URL).flush({}, { status: 500, statusText: 'Error' });
    await failed;
    expect(store.error()).toBe('The client data catalog could not be loaded.');
    expect(store.catalog()).toBeNull();

    const retried = store.reload();
    http.expectOne(URL).flush(catalogResponse());
    await retried;
    expect(store.error()).toBe('');
    expect(store.catalog()).not.toBeNull();
  });
});
