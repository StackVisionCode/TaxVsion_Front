import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { CustomerDocumentAccessService } from './customer-document-access.service';
import { CustomerAccessRuleView, SetDenyRuleRequest } from './customer-document-access.model';

const CUSTOMER = 'customer-1';
const base = 'http://test';

describe('CustomerDocumentAccessService', () => {
  let service: CustomerDocumentAccessService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CustomerDocumentAccessService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ApiConfigService,
          useValue: { tenantUrl: (path: string) => `${base}${path}` },
        },
      ],
    });
    service = TestBed.inject(CustomerDocumentAccessService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('list devuelve [] cuando el backend no tiene reglas', () => {
    let received: CustomerAccessRuleView[] | undefined;
    service.list(CUSTOMER).subscribe(rules => (received = rules));

    const req = httpMock.expectOne(`${base}/storage/customer-access/${CUSTOMER}/rules`);
    expect(req.request.method).toBe('GET');
    req.flush([]);

    expect(received).toEqual([]);
  });

  it('setDeny POSTea el body con SetDenyRuleRequest tal cual', () => {
    const payload: SetDenyRuleRequest = {
      resourceType: 'File',
      resourceId: 'file-7',
      capability: 'Download',
      reason: 'Signed engagement letter pending',
    };
    let completed = false;
    service.setDeny(CUSTOMER, payload).subscribe(() => (completed = true));

    const req = httpMock.expectOne(`${base}/storage/customer-access/${CUSTOMER}/rules`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    // El endpoint devuelve `SetDenyOverrideResponse { rule, created }`; el service desenvuelve el
    // rule antes de que el store lo guarde — el mock imita ese contrato exacto.
    req.flush({
      rule: {
        id: 'rule-1',
        customerId: CUSTOMER,
        resourceType: 'File',
        resourceId: 'file-7',
        resourceName: 'W-2 Acme Corp.pdf',
        capability: 'Download',
        setByUserId: 'user-1',
        setAtUtc: '2026-10-14T00:00:00Z',
        reason: payload.reason,
      },
      created: true,
    });

    expect(completed).toBe(true);
  });

  it('clearDeny DELETEa con los tres query params', () => {
    let completed = false;
    service.clearDeny(CUSTOMER, 'Folder', 'folder-3', 'Preview').subscribe(() => (completed = true));

    const req = httpMock.expectOne(
      r =>
        r.url === `${base}/storage/customer-access/${CUSTOMER}/rules` &&
        r.params.get('resourceType') === 'Folder' &&
        r.params.get('resourceId') === 'folder-3' &&
        r.params.get('capability') === 'Preview',
    );
    expect(req.request.method).toBe('DELETE');
    req.flush(null);

    expect(completed).toBe(true);
  });
});
