import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { StaffDirectoryStore } from './staff-directory.store';

function row(id: string, name: string, isActive: boolean, status: string) {
  return { id, name, lastName: 'Smith', email: `${name.toLowerCase()}@acme.test`, actorType: 'TenantEmployee', isActive, status };
}

/**
 * El directorio pone nombre a las asignaciones existentes. Un suspendido conserva sus clientes, así que
 * tiene que estar en la lista o la tarjeta dice "Unknown user"; pero no se le pueden asignar más.
 */
describe('StaffDirectoryStore', () => {
  let store: StaffDirectoryStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `http://test${path}` } },
      ],
    });
    store = TestBed.inject(StaffDirectoryStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  function flushFirstPage(items: unknown[], totalPages = 1) {
    const request = http.expectOne(r => r.url === 'http://test/auth/users' && r.params.get('page') === '1');
    expect(request.request.params.get('accountKind')).toBe('Staff');
    request.flush({ items, totalPages });
  }

  it('el suspendido entra al directorio pero no es asignable', () => {
    store.ensureLoaded();
    flushFirstPage([row('u1', 'Ada', true, 'Active'), row('u2', 'Grace', false, 'Deactivated')]);

    expect(store.members().map(m => m.userId)).toEqual(['u1', 'u2']);
    expect(store.assignable().map(m => m.userId)).toEqual(['u1']);
    expect(store.resolve('u2')?.name).toBe('Grace Smith');
    expect(store.search('').map(m => m.userId)).toEqual(['u1']);
  });

  it('trae las páginas que falten, no solo las primeras 100', () => {
    store.ensureLoaded();
    flushFirstPage([row('u1', 'Ada', true, 'Active')], 2);
    http
      .expectOne(r => r.url === 'http://test/auth/users' && r.params.get('page') === '2')
      .flush({ items: [row('u2', 'Bob', true, 'Active')], totalPages: 2 });

    expect(store.members().map(m => m.name)).toEqual(['Ada Smith', 'Bob Smith']);
  });

  it('carga una sola vez', () => {
    store.ensureLoaded();
    flushFirstPage([row('u1', 'Ada', true, 'Active')]);
    store.ensureLoaded();

    http.expectNone(() => true);
  });

  it('si la lectura falla el directorio queda vacío, sin romper la pantalla', () => {
    store.ensureLoaded();
    http
      .expectOne(r => r.url === 'http://test/auth/users')
      .flush({ message: 'nope' }, { status: 403, statusText: 'Forbidden' });

    expect(store.members()).toEqual([]);
  });
});
