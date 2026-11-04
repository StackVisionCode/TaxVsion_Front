import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  FALLBACK_OFFICE_LANGUAGE,
  OfficeLanguageStore,
  normalizeOfficeLanguage,
} from './office-language.store';

describe('OfficeLanguageStore', () => {
  const URL = 'https://demo.example.com/api/tenants/current/profile';

  function setup(tenantBase: () => string = () => 'https://demo.example.com/api') {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantBase } },
      ],
    });
    return {
      store: TestBed.inject(OfficeLanguageStore),
      http: TestBed.inject(HttpTestingController),
    };
  }

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('arranca en inglés', () => {
    const { store } = setup();
    expect(store.language()).toBe(FALLBACK_OFFICE_LANGUAGE);
  });

  it('lee `defaultLanguage` del perfil', async () => {
    const { store, http } = setup();
    const result = store.refresh();
    http.expectOne(URL).flush({ defaultLanguage: 'es' });

    expect(await result).toBe('es');
    expect(store.language()).toBe('es');
  });

  it('sin idioma en el perfil cae a inglés', async () => {
    const { store, http } = setup();
    const result = store.refresh();
    http.expectOne(URL).flush({ defaultLanguage: null, version: 0 });

    expect(await result).toBe('en');
  });

  it('si falla resuelve con el último conocido, sin rechazar', async () => {
    const { store, http } = setup();
    const first = store.refresh();
    http.expectOne(URL).flush({ defaultLanguage: 'es' });
    await first;

    const second = store.refresh();
    http.expectOne(URL).flush('boom', { status: 503, statusText: 'Unavailable' });

    expect(await second).toBe('es');
  });

  it('una sola petición viva aunque se pida dos veces', async () => {
    const { store, http } = setup();
    const a = store.refresh();
    const b = store.refresh();
    http.expectOne(URL).flush({ defaultLanguage: 'es' });

    expect(await a).toBe('es');
    expect(await b).toBe('es');
  });

  it('sin slug resuelto no pega al API', async () => {
    const { store } = setup(() => {
      throw new Error('sin tenant');
    });

    expect(await store.refresh()).toBe('en');
  });
});

describe('normalizeOfficeLanguage', () => {
  it('normaliza mayúsculas y descarta idiomas desconocidos', () => {
    expect(normalizeOfficeLanguage(' ES ')).toBe('es');
    expect(normalizeOfficeLanguage('fr')).toBe('en');
    expect(normalizeOfficeLanguage(undefined)).toBe('en');
  });
});
