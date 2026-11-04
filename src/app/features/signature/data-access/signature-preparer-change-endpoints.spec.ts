import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { SignatureService } from './signature.service';
import { detailToUiRequest, SignatureRequestDetail } from './signature.model';

/** Contrato del cambio de preparador de una solicitud enviada (retiro de empleados, D-2). */
describe('SignatureService — change preparer endpoints', () => {
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

  it('changePreparer hace POST con el nuevo preparador', () => {
    service.changePreparer('r1', 'u2').subscribe();

    const req = httpMock.expectOne(`${requestsUrl}/r1/preparer/change`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ newPreparerUserId: 'u2' });
    req.flush(null);
  });

  it('listPreparerCandidates hace GET de los candidatos', () => {
    let result: unknown;
    service.listPreparerCandidates().subscribe((candidates) => (result = candidates));

    const req = httpMock.expectOne(`${requestsUrl}/preparer-candidates`);
    expect(req.request.method).toBe('GET');
    req.flush([{ userId: 'u2', displayName: 'John Roe', titleLabel: null, maskedIdentifier: 'P•••••7766' }]);
    expect(result).toEqual([{ userId: 'u2', displayName: 'John Roe', titleLabel: null, maskedIdentifier: 'P•••••7766' }]);
  });

  it('el detalle expone quién es el preparador y si es el usuario actual', () => {
    const detail = {
      id: 'r1',
      createdByUserId: 'author',
      title: 'Form 8879',
      description: null,
      category: 'Fiscal',
      status: 'InProgress',
      documents: [],
      certificateFileId: null,
      requiresPractitionerPin: false,
      practitionerPinSetAtUtc: null,
      expiresAtUtc: null,
      sentAtUtc: null,
      completedAtUtc: null,
      scheduledSendAtUtc: null,
      sendSealedDocumentToSigners: false,
      sendCertificateToSigners: false,
      generateCertificate: false,
      isPreparerSigned: false,
      preparerSignedAtUtc: null,
      preparerSignatureFileId: null,
      preparerFields: [],
      signers: [],
      preparerUserId: 'me',
      preparerDisplayName: 'Jane Doe, EA',
    } as unknown as SignatureRequestDetail;

    const ui = detailToUiRequest(detail, 'me');

    expect(ui.preparerDisplayName).toBe('Jane Doe, EA');
    expect(ui.isActorPreparer).toBe(true);
    expect(ui.isPreparerSigned).toBe(false);
    expect(detailToUiRequest(detail, 'someone-else').isActorPreparer).toBe(false);
  });
});
