import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { PublicSignatureService } from './public-signature.service';

describe('PublicSignatureService', () => {
  let service: PublicSignatureService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PublicSignatureService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ApiConfigService,
          useValue: {
            tenantUrl: (path: string) => `http://localhost:5047${path}`,
            systemUrl: (path: string) => `http://localhost:5047${path}`,
          },
        },
      ],
    });
    service = TestBed.inject(PublicSignatureService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('downloads a specific PDF through the singular public document route', () => {
    let bytes: Uint8Array | undefined;
    service
      .getDocumentBytes('signed-token', '11111111-1111-1111-1111-111111111111')
      .subscribe((value) => {
        bytes = value;
      });

    const request = httpMock.expectOne(
      'http://localhost:5047/signature/public/signed-token/document/11111111-1111-1111-1111-111111111111',
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.responseType).toBe('arraybuffer');
    request.flush(new Uint8Array([37, 80, 68, 70]).buffer);

    expect(Array.from(bytes ?? [])).toEqual([37, 80, 68, 70]);
  });
});
