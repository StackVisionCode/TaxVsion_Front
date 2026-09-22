import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { SignatureService } from './signature.service';
import { UpdateSignatureRequestBody } from './signature.model';

/**
 * Contrato de los endpoints del flujo Draft (F4a) contra el backend real:
 * PUT /{id} (editar metadata), DELETE /{id} (borrar borrador) y el filtro
 * editableOnly de la lista.
 */
describe('SignatureService — draft endpoints', () => {
  let service: SignatureService;
  let httpMock: HttpTestingController;

  const requestsUrl = `${environment.apiUrl}/signature/requests`;
  const requestId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SignatureService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SignatureService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('update edita la metadata con PUT /{id}', () => {
    const body: UpdateSignatureRequestBody = {
      title: 'Renamed',
      description: null,
      category: 'Fiscal',
      tokenExpirationHours: 120,
    };
    service.update(requestId, body).subscribe();

    const req = httpMock.expectOne(`${requestsUrl}/${requestId}`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(body);
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('deleteRequest borra con DELETE /{id} sin body', () => {
    service.deleteRequest(requestId).subscribe();

    const req = httpMock.expectOne(`${requestsUrl}/${requestId}`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toBeNull();
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('list pasa editableOnly=true como query param', () => {
    service.list({ editableOnly: true, page: 1, size: 8 }).subscribe();

    const req = httpMock.expectOne(r => r.url === requestsUrl && r.params.get('editableOnly') === 'true');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('editableOnly')).toBe('true');
    req.flush({ items: [], totalCount: 0, page: 1, pageSize: 8 });
  });

  it('list omite editableOnly cuando es false/ausente', () => {
    service.list({ page: 1, size: 8 }).subscribe();

    const req = httpMock.expectOne(r => r.url === requestsUrl);
    expect(req.request.params.has('editableOnly')).toBe(false);
    req.flush({ items: [], totalCount: 0, page: 1, pageSize: 8 });
  });
});
