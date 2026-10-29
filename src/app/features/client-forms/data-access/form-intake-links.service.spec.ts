import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { firstValueFrom } from 'rxjs';
import { intakeLinkResponse } from '../testing/intake-link.fixture';
import { FormIntakeLinksService } from './form-intake-links.service';

describe('FormIntakeLinksService', () => {
  let http: HttpTestingController;
  let service: FormIntakeLinksService;
  const base = 'https://api.test/tasks/forms/intake-links';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `https://api.test${path}` } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(FormIntakeLinksService);
  });

  afterEach(() => http.verify());

  it('lists links as a plain array', async () => {
    const result = firstValueFrom(service.list());
    http.expectOne({ method: 'GET', url: base }).flush([intakeLinkResponse()]);
    expect((await result)[0].status).toBe('Active');
  });

  it('creates a link and gets back the link wrapped with its raw token', async () => {
    const result = firstValueFrom(
      service.create({
        name: 'Website intake',
        formTemplateId: 'template-1',
        formTemplateVersionId: null,
        entryNoticeKey: 'identity_notice',
        expiresAtUtc: '2026-12-31T23:59:59Z',
        maxSubmissions: 50,
        responsibleUserId: 'user-1',
      }),
    );
    const request = http.expectOne({ method: 'POST', url: base });
    expect(request.request.body).toEqual({
      name: 'Website intake',
      formTemplateId: 'template-1',
      formTemplateVersionId: null,
      entryNoticeKey: 'identity_notice',
      expiresAtUtc: '2026-12-31T23:59:59Z',
      maxSubmissions: 50,
      responsibleUserId: 'user-1',
    });
    request.flush({ link: intakeLinkResponse(), token: 'raw-token' }, { status: 201, statusText: 'Created' });
    const response = await result;
    expect(response.token).toBe('raw-token');
    expect(response.link.id).toBe('link-1');
  });

  it('sends only the row version to the state actions', async () => {
    for (const action of ['pause', 'resume', 'revoke', 'regenerate-token'] as const) {
      const result = firstValueFrom(service.change('link-1', action, 'rv'));
      const request = http.expectOne({ method: 'POST', url: `${base}/link-1/${action}` });
      expect(request.request.body).toEqual({ rowVersion: 'rv' });
      request.flush({ link: intakeLinkResponse(), token: action === 'regenerate-token' ? 'new' : null });
      await result;
    }
  });

  it('pins a version with the version id and row version', async () => {
    const result = firstValueFrom(service.pinVersion('link-1', 'version-3', 'rv'));
    const request = http.expectOne({ method: 'POST', url: `${base}/link-1/pin-version` });
    expect(request.request.body).toEqual({ formTemplateVersionId: 'version-3', rowVersion: 'rv' });
    request.flush({ link: intakeLinkResponse({ formTemplateVersionId: 'version-3' }), token: null });
    expect((await result).link.formTemplateVersionId).toBe('version-3');
  });

  it('reads the token for copying', async () => {
    const result = firstValueFrom(service.token('link-1'));
    http
      .expectOne({ method: 'GET', url: `${base}/link-1/token` })
      .flush({ link: intakeLinkResponse(), token: 'raw-token' });
    expect((await result).token).toBe('raw-token');
  });
});
