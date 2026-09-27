import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { ClientsStore } from './clients.store';
import { ClientsService } from './clients.service';
import { Customer } from './clients.model';

/**
 * B5 — la pérdida silenciosa del alta de clientes.
 *
 * El SSN/EIN y el toggle Active NO viajan en el POST: son dos llamadas más, cada una con su
 * permiso. Los 403 se tragaban con un `catchError`, el formulario decía "guardado" y el dato
 * desaparecía. El otro lado del arreglo es el formulario, que ya no muestra esos campos a quien no
 * puede guardarlos; esto cubre lo que queda: cuando se intenta y falla, se dice.
 */
describe('ClientsStore · guardado parcial', () => {
  const CREATED: Customer = {
    id: 'cus-1',
    tenantId: 't-1',
    kind: 'Individual',
    status: 'Active',
    displayName: 'Ana López',
    primaryEmail: 'ana@example.com',
    primaryPhone: null,
    language: 'En',
    preferredChannel: 'Email',
    occupationId: null,
    occupationName: null,
    principalBusinessActivityId: null,
    principalBusinessActivityName: null,
    createdAtUtc: '2026-01-01T00:00:00Z',
    assignedPreparerUserId: null,
  };

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

  function save(store: ClientsStore, isActive: boolean, taxIdentifier: string) {
    const emitted: { isActive: boolean }[] = [];
    store
      .createClient({ displayName: 'Ana López', subjectKind: 'Individual' } as never, {
        taxIdentifier,
        subjectKind: 'Individual',
        isActive,
      })
      .subscribe(item => emitted.push(item));
    return emitted;
  }

  it('todo bien: no hay aviso', () => {
    const { store, http } = setup();
    const emitted = save(store, true, '');

    http.expectOne(req => req.method === 'POST').flush(CREATED);

    expect(store.partialSaveWarning()).toBeNull();
    expect(emitted[0].isActive).toBe(true);
  });

  it('si el cambio de estado falla, NO se devuelve el estado que se pidió', () => {
    // Éste era el engaño concreto: la fila se pintaba "Inactive" mientras el backend la tenía
    // activa, y al recargar volvía a aparecer activa sin explicación.
    const { store, http } = setup();
    const emitted = save(store, false, '');

    http.expectOne(req => req.method === 'POST').flush(CREATED);
    http
      .expectOne(req => req.url.endsWith('/deactivate'))
      .flush('nope', { status: 403, statusText: 'Forbidden' });

    expect(emitted[0].isActive).toBe(true); // el estado REAL del cliente creado
    expect(store.partialSaveWarning()).toContain('the active status');
  });

  it('si el perfil fiscal falla, el aviso nombra el dato perdido', () => {
    const { store, http } = setup();
    save(store, true, '123456789');

    http.expectOne(req => req.method === 'POST').flush(CREATED);
    http
      .expectOne(req => req.url.includes('fiscal-profile'))
      .flush('nope', { status: 403, statusText: 'Forbidden' });

    expect(store.partialSaveWarning()).toContain('the tax ID');
    expect(store.partialSaveWarning()).not.toContain('the active status');
  });

  it('si fallan los dos, el aviso los nombra a los dos', () => {
    const { store, http } = setup();
    save(store, false, '123456789');

    http.expectOne(req => req.method === 'POST').flush(CREATED);
    http
      .expectOne(req => req.url.endsWith('/deactivate'))
      .flush('nope', { status: 403, statusText: 'Forbidden' });
    http
      .expectOne(req => req.url.includes('fiscal-profile'))
      .flush('nope', { status: 403, statusText: 'Forbidden' });

    expect(store.partialSaveWarning()).toContain('the active status and the tax ID');
  });

  it('el aviso se puede limpiar al reabrir el formulario', () => {
    const { store, http } = setup();
    save(store, true, '123456789');
    http.expectOne(req => req.method === 'POST').flush(CREATED);
    http.expectOne(req => req.url.includes('fiscal-profile')).flush('x', { status: 403, statusText: 'Forbidden' });
    expect(store.partialSaveWarning()).not.toBeNull();

    store.clearPartialSaveWarning();

    expect(store.partialSaveWarning()).toBeNull();
  });
});
