import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { firstValueFrom } from 'rxjs';
import { FormLibraryService } from './form-library.service';

describe('FormLibraryService', () => {
  let http: HttpTestingController;
  let service: FormLibraryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `https://api.test${path}` } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(FormLibraryService);
  });

  afterEach(() => http.verify());

  it('lists the library', async () => {
    const result = firstValueFrom(service.list());
    const request = http.expectOne('https://api.test/tasks/forms/library');
    expect(request.request.method).toBe('GET');
    request.flush([
      { key: 'individual-tax-intake', name: 'Individual Tax Intake', description: null, purpose: 'clientIntake', latestVersionNumber: 2 },
    ]);
    expect((await result)[0].latestVersionNumber).toBe(2);
  });

  it('previews a library template by key', async () => {
    const result = firstValueFrom(service.preview('individual-tax-intake'));
    const request = http.expectOne('https://api.test/tasks/forms/library/individual-tax-intake');
    expect(request.request.method).toBe('GET');
    request.flush({ key: 'individual-tax-intake', name: 'Individual Tax Intake', description: null, purpose: 'clientIntake', versionNumber: 2, definition: '{}' });
    expect((await result).definition).toBe('{}');
  });

  it('clones a library template', async () => {
    const result = firstValueFrom(service.clone('business-intake'));
    const request = http.expectOne('https://api.test/tasks/forms/library/business-intake/clone');
    expect(request.request.method).toBe('POST');
    request.flush({ id: 'clone-1', libraryOrigin: { libraryKey: 'business-intake', sourceTemplateId: 'src-1', sourceVersionNumber: 2 } });
    expect((await result).id).toBe('clone-1');
  });

  it('records a review with the body the backend expects', async () => {
    const result = firstValueFrom(service.recordReview('template-1', { reviewedVersionNumber: 1, reviewerRole: 'EA', note: 'ok' }));
    const request = http.expectOne('https://api.test/tasks/forms/library/template-1/reviews');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ reviewedVersionNumber: 1, reviewerRole: 'EA', note: 'ok' });
    request.flush({ id: 'template-1' });
    await result;
  });

  it('sets the listing with the body the backend expects', async () => {
    const result = firstValueFrom(service.setListing('template-1', { libraryKey: 'individual-tax-intake', isListed: true }));
    const request = http.expectOne('https://api.test/tasks/forms/library/template-1/listing');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ libraryKey: 'individual-tax-intake', isListed: true });
    request.flush({ id: 'template-1', isLibraryListed: true });
    expect((await result).isLibraryListed).toBe(true);
  });

  it('exports a template as text', async () => {
    const result = firstValueFrom(service.exportTemplate('template-1'));
    const request = http.expectOne('https://api.test/tasks/forms/templates/template-1/export');
    expect(request.request.method).toBe('GET');
    expect(request.request.responseType).toBe('text');
    request.flush('{"schemaVersion":1}');
    expect(await result).toBe('{"schemaVersion":1}');
  });
});
