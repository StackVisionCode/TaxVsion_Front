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
  it('applies the confirmed pause even when refreshing the list fails', () => {
    const { store, http } = setup();
    const schedule = { id: 'schedule-1', campaignId: 'campaign-1', status: 'Active' };
    store.loadSchedules('campaign-1');
    http.expectOne(req => req.url.endsWith('/campaign-1/schedules')).flush({ items: [schedule] });

    store.setScheduleState('campaign-1', 'schedule-1', 'pause').subscribe();
    const pause = http.expectOne('https://api.test/campaigns/schedules/schedule-1/pause');
    expect(pause.request.method).toBe('POST');
    pause.flush({ ...schedule, status: 'Paused' });
    expect(store.schedules()[0].status).toBe('Paused');

    http.expectOne(req => req.url.endsWith('/campaign-1/schedules')).flush(
      'Unavailable', { status: 503, statusText: 'Unavailable' },
    );
    expect(store.schedules()[0].status).toBe('Paused');
    http.verify();
  });

  it('does not show a schedule as paused when the server rejects the action', () => {
    const { store, http } = setup();
    store.loadSchedules('campaign-1');
    http.expectOne(req => req.url.endsWith('/campaign-1/schedules')).flush({
      items: [{ id: 'schedule-1', campaignId: 'campaign-1', status: 'Active' }],
    });
    store.setScheduleState('campaign-1', 'schedule-1', 'pause').subscribe({ error: () => {} });
    http.expectOne('https://api.test/campaigns/schedules/schedule-1/pause').flush(
      { message: 'Not allowed' }, { status: 403, statusText: 'Forbidden' },
    );
    expect(store.schedules()[0].status).toBe('Active');
    expect(store.actionError()).toBeTruthy();
    http.verify();
  });

});
