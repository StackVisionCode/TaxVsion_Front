import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { CampaignsStore } from './campaigns.store';
import { CampaignsService } from './campaigns.service';

/**
 * B5 — las seis sub-listas de Campaigns se cargaban con `error: () => {}`.
 *
 * Para un empleado sin `campaigns.manage` eso significaba una pantalla entera de listas vacías:
 * "0 sender profiles", "no runs yet". No es lo mismo "no hay" que "no pudimos preguntar", y la
 * diferencia importa — con la primera lectura el usuario no hace nada, con la segunda va a pedir
 * acceso.
 */
describe('CampaignsStore · sub-listas', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        CampaignsService,
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `https://api.test${path}` } },
      ],
    });
    return { store: TestBed.inject(CampaignsStore), http: TestBed.inject(HttpTestingController) };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('arranca sin errores', () => {
    const { store } = setup();

    expect(Object.values(store.subErrors()).every(error => error === null)).toBe(true);
  });

  it('un 403 en remitentes deja de ser una lista vacía', () => {
    const { store, http } = setup();
    store.loadSenders();

    http.expectOne(req => req.url.includes('sender')).flush(
      { code: 'Auth.Forbidden', message: 'You do not have access to campaigns.' },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(store.senders()).toEqual([]);
    expect(store.subErrors().senders).toBe('You do not have access to campaigns.');
  });

  it('cada sub-lista falla por su cuenta', () => {
    // Que una falle no puede ensuciar a las otras: se leen de endpoints distintos.
    const { store, http } = setup();
    store.loadSenders();
    store.loadLists();

    http.expectOne(req => req.url.includes('sender')).flush('x', { status: 403, statusText: 'Forbidden' });
    http.expectOne(req => req.url.includes('contact-list')).flush({ items: [], total: 0 });

    expect(store.subErrors().senders).not.toBeNull();
    expect(store.subErrors().lists).toBeNull();
  });

  it('un reintento que funciona limpia el error', () => {
    const { store, http } = setup();
    store.loadSenders();
    http.expectOne(req => req.url.includes('sender')).flush('x', { status: 403, statusText: 'Forbidden' });
    expect(store.subErrors().senders).not.toBeNull();

    store.loadSenders();
    http.expectOne(req => req.url.includes('sender')).flush({ items: [], total: 0 });

    expect(store.subErrors().senders).toBeNull();
  });
});
