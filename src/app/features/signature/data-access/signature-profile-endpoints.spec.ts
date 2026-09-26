import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { SignatureService } from './signature.service';

/** Contrato de los endpoints de firmas reutilizables del preparador (14.5 F1/F2). */
describe('SignatureService — signature profile endpoints', () => {
  let service: SignatureService;
  let httpMock: HttpTestingController;

  const profilesUrl = `${environment.apiUrl}/signature/profiles`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SignatureService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SignatureService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listSignatureProfiles sin archivadas no manda el query param', () => {
    service.listSignatureProfiles().subscribe();

    const req = httpMock.expectOne(r => r.url === profilesUrl);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.has('includeArchived')).toBe(false);
    req.flush({ profiles: [] });
  });

  it('listSignatureProfiles(true) manda includeArchived=true', () => {
    service.listSignatureProfiles(true).subscribe();

    const req = httpMock.expectOne(r => r.url === profilesUrl && r.params.get('includeArchived') === 'true');
    expect(req.request.method).toBe('GET');
    req.flush({ profiles: [] });
  });

  it('getEffectiveSignature hace GET a /effective', () => {
    service.getEffectiveSignature().subscribe();

    const req = httpMock.expectOne(`${profilesUrl}/effective`);
    expect(req.request.method).toBe('GET');
    req.flush({ id: 'p1', ownerUserId: 'u1', isOffice: false, label: 'Blue', fileId: 'f1', width: 100, height: 50, isDefault: true, isArchived: false });
  });

  it('createSignatureProfile hace POST con label/scope/imageBase64', () => {
    service.createSignatureProfile({ label: 'Blue', scope: 'user', imageBase64: 'AAAA' }).subscribe();

    const req = httpMock.expectOne(profilesUrl);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ label: 'Blue', scope: 'user', imageBase64: 'AAAA' });
    req.flush({ id: 'p1', ownerUserId: 'u1', isOffice: false, label: 'Blue', fileId: 'f1', width: 100, height: 50, isDefault: true, isArchived: false });
  });

  it('renameSignatureProfile hace PUT al id con el label', () => {
    service.renameSignatureProfile('p1', 'Black').subscribe();

    const req = httpMock.expectOne(`${profilesUrl}/p1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ label: 'Black' });
    req.flush(null);
  });

  it('setDefaultSignatureProfile hace POST a /{id}/default', () => {
    service.setDefaultSignatureProfile('p1').subscribe();

    const req = httpMock.expectOne(`${profilesUrl}/p1/default`);
    expect(req.request.method).toBe('POST');
    req.flush(null);
  });

  it('archive/unarchive/delete pegan a las rutas correctas', () => {
    service.archiveSignatureProfile('p1').subscribe();
    httpMock.expectOne(r => r.url === `${profilesUrl}/p1/archive` && r.method === 'POST').flush(null);

    service.unarchiveSignatureProfile('p1').subscribe();
    httpMock.expectOne(r => r.url === `${profilesUrl}/p1/unarchive` && r.method === 'POST').flush(null);

    service.deleteSignatureProfile('p1').subscribe();
    httpMock.expectOne(r => r.url === `${profilesUrl}/p1` && r.method === 'DELETE').flush(null);
  });
});
