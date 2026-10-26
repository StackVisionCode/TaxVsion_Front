import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { firstValueFrom } from 'rxjs';
import { FormRequestsService } from './form-requests.service';

describe('FormRequestsService (external participants)', () => {
  let http: HttpTestingController;
  let service: FormRequestsService;
  const base = 'https://api.test/tasks/forms';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `https://api.test${path}` } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(FormRequestsService);
  });

  afterEach(() => http.verify());

  it('posts the external assignment with the AssignExternalFormRequestRequest fields', async () => {
    const input = {
      email: 'prospect@example.com',
      fullName: 'Pat Prospect',
      templateId: 'template-1',
      entryNoticeKey: 'identity_notice',
      title: null,
      messageToClient: 'Please fill this out',
      dueAtUtc: '2026-11-15T00:00:00Z',
      taxYear: 2026,
    };
    const result = firstValueFrom(service.assignExternal(input));
    const request = http.expectOne({ method: 'POST', url: `${base}/requests/external` });
    expect(request.request.body).toEqual(input);
    // 201 con FormRequestResponse plano (CreatedAtAction), sin envoltorio.
    request.flush(
      {
        id: 'request-9',
        participant: { kind: 'External', customerId: null, participantId: 'participant-1' },
        origin: 'Directed',
        customerLinkStatus: 'None',
        responsibleUserId: 'user-1',
        formTemplateId: 'template-1',
        formTemplateVersionId: 'version-2',
        versionNumber: 2,
        title: 'Organizer',
        messageToClient: 'Please fill this out',
        taxYear: 2026,
        taskId: null,
        dueAtUtc: '2026-11-15T00:00:00',
        status: 'Pending',
        progressPercent: 0,
        currentRevisionNumber: 0,
        lastSubmittedAtUtc: null,
        rowVersion: 'AAAAAAAAB9E=',
      },
      { status: 201, statusText: 'Created' },
    );
    const created = await result;
    expect(created.participant.kind).toBe('External');
    expect(created.origin).toBe('Directed');
    expect(created.responsibleUserId).toBe('user-1');
  });

  it('resends the external access with an empty body and accepts 204', async () => {
    const result = firstValueFrom(service.resendExternalAccess('request-9'));
    const request = http.expectOne({
      method: 'POST',
      url: `${base}/requests/request-9/external-access/resend`,
    });
    expect(request.request.body).toEqual({});
    request.flush(null, { status: 204, statusText: 'No Content' });
    await expect(result).resolves.toBeNull();
  });

  it('reads entry notices from the scoped active endpoint (ActiveConsentNoticeResponse array)', async () => {
    const result = firstValueFrom(service.entryNotices());
    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === `${base}/consent-notices/active`,
    );
    expect(request.request.params.get('purpose')).toBe('IdentityVerification');
    request.flush([
      {
        id: 'notice-1',
        key: 'identity_check',
        title: 'Identity verification',
        purpose: 'IdentityVerification',
        versionNumber: 2,
        language: 'en',
        textSnapshot: 'We collect your email to verify your identity.',
        contentHash: 'abc123',
        publishedAtUtc: '2026-10-01T00:00:00',
      },
    ]);
    const notices = await result;
    expect(notices[0].versionNumber).toBe(2);
    expect(notices[0].key).toBe('identity_check');
  });

  it('reads every page of active staff instead of truncating at 100', async () => {
    const user = (id: string, isActive = true) => ({
      id,
      name: `Name ${id}`,
      lastName: 'Staff',
      email: `${id}@example.com`,
      isActive,
    });
    const result = firstValueFrom(service.activeStaff());
    const first = http.expectOne(
      (req) => req.url === 'https://api.test/auth/users' && req.params.get('page') === '1',
    );
    expect(first.request.params.get('size')).toBe('100');
    expect(first.request.params.get('accountKind')).toBe('Staff');
    expect(first.request.params.get('isActive')).toBe('true');
    // PagedResult real de Auth: { items, page, size, totalCount }.
    first.flush({ items: [user('u1')], page: 1, size: 100, totalCount: 150 });
    const second = http.expectOne(
      (req) => req.url === 'https://api.test/auth/users' && req.params.get('page') === '2',
    );
    second.flush({ items: [user('u2'), user('u3', false)], page: 2, size: 100, totalCount: 150 });

    const staff = await result;
    expect(staff.map((member) => member.userId)).toEqual(['u1', 'u2']);
  });
});
