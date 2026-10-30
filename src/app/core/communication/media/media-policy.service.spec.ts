import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiConfigService } from '@core/config/api-config.service';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { SETTINGS_CHANGED_EVENT } from '@core/realtime/realtime.model';
import { MediaPolicyService } from './media-policy.service';
import { mediaPolicyFixture } from './testing/media-policy.fixture';

describe('MediaPolicyService', () => {
  let service: MediaPolicyService;
  let http: HttpTestingController;
  const events = new Subject<{ event: string; payload: unknown }>();

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        MediaPolicyService,
        { provide: ApiConfigService, useValue: { tenantUrl: (p: string) => `https://x${p}` } },
        { provide: CommunicationRealtimeService, useValue: { on: (event: string) => filtered(event) } },
      ],
    });
    service = TestBed.inject(MediaPolicyService);
    http = TestBed.inject(HttpTestingController);
  });

  function filtered(event: string) {
    const out = new Subject<unknown>();
    events.subscribe(e => {
      if (e.event === event) {
        out.next(e.payload);
      }
    });
    return out;
  }

  afterEach(() => http.verify());

  it('ensureLoaded hace UNA petición aunque la pidan varios a la vez y cachea por sesión', async () => {
    const a = service.ensureLoaded();
    const b = service.ensureLoaded();
    const req = http.expectOne('https://x/communication/media-policy');
    req.flush(mediaPolicyFixture({ version: 7 }));
    expect((await a).version).toBe(7);
    expect((await b).version).toBe(7);
    expect(service.policy()?.version).toBe(7);
    await service.ensureLoaded(); // ya cacheada: sin petición (http.verify lo comprueba)
  });

  it('rechaza una respuesta que no tiene la forma del DTO (no cachea basura)', async () => {
    const pending = service.ensureLoaded();
    http.expectOne('https://x/communication/media-policy').flush({ html: '<html>' });
    await expect(pending).rejects.toThrow();
    expect(service.policy()).toBeNull();
  });

  it('settings.changed refresca la política ya cargada', async () => {
    const first = service.ensureLoaded();
    http.expectOne('https://x/communication/media-policy').flush(mediaPolicyFixture({ version: 1 }));
    await first;

    events.next({ event: SETTINGS_CHANGED_EVENT, payload: { scope: 'platform', version: 2 } });
    http.expectOne('https://x/communication/media-policy').flush(mediaPolicyFixture({ version: 2 }));
    await Promise.resolve();
    expect(service.policy()?.version).toBe(2);
  });

  it('prime (invitado F6) fija la política sin red y settings.changed no la vuelve a pedir', async () => {
    service.prime(mediaPolicyFixture({ version: 9 }));
    expect((await service.ensureLoaded()).version).toBe(9);
    events.next({ event: SETTINGS_CHANGED_EVENT, payload: { scope: 'platform', version: 10 } });
    await Promise.resolve();
    http.expectNone('https://x/communication/media-policy');
    expect(service.policy()?.version).toBe(9);

    service.unprime();
    expect(service.policy()).toBeNull();
    const pending = service.ensureLoaded(); // con sesión otra vez: vuelve a la red
    http.expectOne('https://x/communication/media-policy').flush(mediaPolicyFixture({ version: 11 }));
    expect((await pending).version).toBe(11);
  });

  it('updatePreferences hace PUT y vuelve a leer la política efectiva', async () => {
    const pending = service.updatePreferences({ joinMuted: true });
    const put = http.expectOne({ method: 'PUT', url: 'https://x/communication/preferences' });
    expect(put.request.body).toEqual({ joinMuted: true });
    put.flush({});
    await Promise.resolve();
    http.expectOne('https://x/communication/media-policy').flush(mediaPolicyFixture({ version: 3 }));
    expect((await pending).version).toBe(3);
  });
});
