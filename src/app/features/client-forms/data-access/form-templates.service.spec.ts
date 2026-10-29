import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TokenService } from '@core/auth/token.service';
import { ApiConfigService } from '@core/config/api-config.service';
import { firstValueFrom } from 'rxjs';
import { FormTemplatesService } from './form-templates.service';

describe('FormTemplatesService', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `https://api.test${path}` } },
        { provide: TokenService, useValue: { getAccessToken: () => null } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // El backend responde 200 con la versión publicada, no con un envoltorio { published, version }.
  it('turns the published version into a successful publish outcome', async () => {
    const result = firstValueFrom(TestBed.inject(FormTemplatesService).publish('template-1', 'rv-1'));

    const request = http.expectOne('https://api.test/tasks/forms/templates/template-1/publish');
    expect(request.request.body).toEqual({ rowVersion: 'rv-1' });
    request.flush({ id: 'version-2', templateId: 'template-1', versionNumber: 2 });

    const outcome = await result;
    expect(outcome.published).toBe(true);
    expect(outcome.version?.versionNumber).toBe(2);
    expect(outcome.issues).toEqual([]);
  });
});
