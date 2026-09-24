import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { SignatureService } from './signature.service';

/** Contrato de los endpoints de campos del preparador (14.5 F3/F5). */
describe('SignatureService — preparer field endpoints', () => {
  let service: SignatureService;
  let httpMock: HttpTestingController;

  const requestsUrl = `${environment.apiUrl}/signature/requests`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SignatureService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SignatureService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('placePreparerField hace POST con la caja normalizada', () => {
    service
      .placePreparerField('r1', { kind: 'Signature', page: 1, x: 0.1, y: 0.8, width: 0.2, height: 0.05, label: null })
      .subscribe();

    const req = httpMock.expectOne(`${requestsUrl}/r1/preparer-fields`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ kind: 'Signature', page: 1, x: 0.1, y: 0.8, width: 0.2, height: 0.05, label: null });
    req.flush({ id: 'pf1', kind: 'Signature', page: 1, x: 0.1, y: 0.8, width: 0.2, height: 0.05, label: null });
  });

  it('removePreparerField hace DELETE al id', () => {
    service.removePreparerField('r1', 'pf1').subscribe();

    const req = httpMock.expectOne(`${requestsUrl}/r1/preparer-fields/pf1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('setPreparerSignature hace PUT con el fileId (o null)', () => {
    service.setPreparerSignature('r1', 'file-9').subscribe();

    const req = httpMock.expectOne(`${requestsUrl}/r1/preparer-signature`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ signatureFileId: 'file-9' });
    req.flush(null);
  });
});
