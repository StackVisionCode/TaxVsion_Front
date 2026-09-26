import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { SignatureService } from './signature.service';

/** Contrato de los endpoints de categorías del tenant (14.5): list (+includeArchived) y create. */
describe('SignatureService — category endpoints', () => {
  let service: SignatureService;
  let httpMock: HttpTestingController;

  const categoriesUrl = `${environment.apiUrl}/signature/categories`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SignatureService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SignatureService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listCategories sin archivadas no manda el query param', () => {
    service.listCategories().subscribe();

    const req = httpMock.expectOne(r => r.url === categoriesUrl);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.has('includeArchived')).toBe(false);
    req.flush({ categories: [] });
  });

  it('listCategories(true) manda includeArchived=true', () => {
    service.listCategories(true).subscribe();

    const req = httpMock.expectOne(r => r.url === categoriesUrl && r.params.get('includeArchived') === 'true');
    expect(req.request.method).toBe('GET');
    req.flush({ categories: [] });
  });

  it('createCategory hace POST con el nombre', () => {
    service.createCategory('Payroll').subscribe();

    const req = httpMock.expectOne(categoriesUrl);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Payroll' });
    req.flush({ id: 'c1', name: 'Payroll', isSystem: false, isArchived: false });
  });

  it('renameCategory hace PUT al id con el nombre', () => {
    service.renameCategory('c1', 'Payroll US').subscribe();

    const req = httpMock.expectOne(`${categoriesUrl}/c1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ name: 'Payroll US' });
    req.flush(null);
  });

  it('archiveCategory hace POST a /{id}/archive', () => {
    service.archiveCategory('c1').subscribe();

    const req = httpMock.expectOne(`${categoriesUrl}/c1/archive`);
    expect(req.request.method).toBe('POST');
    req.flush(null);
  });

  it('unarchiveCategory hace POST a /{id}/unarchive', () => {
    service.unarchiveCategory('c1').subscribe();

    const req = httpMock.expectOne(`${categoriesUrl}/c1/unarchive`);
    expect(req.request.method).toBe('POST');
    req.flush(null);
  });
});
