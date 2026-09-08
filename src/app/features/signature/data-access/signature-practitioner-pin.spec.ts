import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { SignatureService } from './signature.service';

/**
 * Fija el contrato del PIN del preparador contra el backend real.
 *
 * Existe porque la guía de integración lo documenta como `POST`, y el
 * controller (`SignatureRequestsController`) lo expone como **PUT**: seguir la
 * guía al pie daba 405. Este test falla si alguien vuelve a cambiarlo.
 *
 * Importa más de lo que parece: el dominio solo bloquea la firma con
 * `RequiresPractitionerPin && !signer.IsPinVerified`, y ese flag se enciende
 * únicamente cuando el staff fija un PIN. Si esta llamada no funciona, el paso
 * de verificación del firmante nunca aparece.
 */
describe('SignatureService — practitioner PIN', () => {
  let service: SignatureService;
  let httpMock: HttpTestingController;

  const pinUrl = (id: string) => `${environment.apiUrl}/signature/requests/${id}/practitioner-pin`;
  const requestId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SignatureService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SignatureService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('fija el PIN con PUT y el body {pin} que espera SetPractitionerPinBody', () => {
    service.setPractitionerPin(requestId, '1234').subscribe();

    const req = httpMock.expectOne(pinUrl(requestId));
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ pin: '1234' });
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('quita el PIN con DELETE y sin body', () => {
    service.clearPractitionerPin(requestId).subscribe();

    const req = httpMock.expectOne(pinUrl(requestId));
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toBeNull();
    req.flush(null, { status: 204, statusText: 'No Content' });
  });
});
