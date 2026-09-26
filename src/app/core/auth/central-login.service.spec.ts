import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '../config/api-config.service';
import { CentralLoginService } from './central-login.service';

/** La misma persona puede ser empleado y cliente de una oficina con el mismo email: cada paso dice qué cuenta. */
describe('CentralLoginService', () => {
  const systemBase = 'http://api.test';
  let service: CentralLoginService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { systemBase: () => systemBase, tenantBase: () => systemBase } },
      ],
    });
    service = TestBed.inject(CentralLoginService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('el login de clientes pide solo cuentas Portal', () => {
    service.discover('ana@example.com', 'secret', 'Portal').subscribe();

    const req = http.expectOne(`${systemBase}/auth/discover-login`);
    expect(req.request.body).toEqual({ email: 'ana@example.com', password: 'secret', accountKind: 'Portal' });
    req.flush({ subdomain: null, ticket: null, discoverySessionRef: 'ref', offices: [], isClientPortal: null });
  });

  it('el login del staff no acota: autentica ambas cuentas', () => {
    service.discover('ana@example.com', 'secret').subscribe();

    const req = http.expectOne(`${systemBase}/auth/discover-login`);
    expect(req.request.body.accountKind).toBeUndefined();
    req.flush({ subdomain: null, ticket: null, discoverySessionRef: 'ref', offices: [], isClientPortal: null });
  });

  it('al elegir oficina manda el tipo de cuenta de esa entrada', () => {
    service.handoff('ref', 'tenant-1', null, 'Portal').subscribe();

    const req = http.expectOne(`${systemBase}/auth/session/handoff`);
    expect(req.request.body).toEqual({
      discoverySessionRef: 'ref',
      chosenTenantId: 'tenant-1',
      mfaCode: null,
      accountKind: 'Portal',
    });
    req.flush({ subdomain: 'acme', ticket: 't' });
  });
});
