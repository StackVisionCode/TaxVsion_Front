import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiConfigService } from '@core/config/api-config.service';
import { ANONYMOUS_REQUEST } from '@core/http/anonymous-request';
import { GuestMeetingService } from './guest-meeting.service';

describe('GuestMeetingService (F6)', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `https://api.test${path}` } },
      ],
    });
    return { service: TestBed.inject(GuestMeetingService), http: TestBed.inject(HttpTestingController) };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('pide el contexto como petición anónima, con el token en el cuerpo (nunca en la URL)', () => {
    const { service, http } = setup();
    service.context('tok/1').subscribe();
    const req = http.expectOne('https://api.test/communication/meetings/guest/context');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ token: 'tok/1' });
    expect(req.request.context.get(ANONYMOUS_REQUEST)).toBe(true);
    req.flush({});
    http.verify();
  });

  it('join-by-token manda token y displayName en el cuerpo, también anónimo', () => {
    const { service, http } = setup();
    service.joinByToken('tok', 'Ana').subscribe();
    const req = http.expectOne('https://api.test/communication/meetings/join-by-token');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ token: 'tok', displayName: 'Ana' });
    expect(req.request.context.get(ANONYMOUS_REQUEST)).toBe(true);
    req.flush({});
    http.verify();
  });
});
