import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { UserManagementService } from './user-management.service';
import { UserEffectiveAccess } from './user-management.model';

/**
 * Contract of the deny-layer service methods against the Auth endpoints (`/auth/users/{id}/...`).
 * ApiConfigService is stubbed so the base URL is deterministic without tenant resolution.
 */
describe('UserManagementService — permission overrides', () => {
  let service: UserManagementService;
  let httpMock: HttpTestingController;

  const base = 'http://test/auth';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        UserManagementService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ApiConfigService,
          useValue: { tenantUrl: (path: string) => `http://test${path}` },
        },
      ],
    });
    service = TestBed.inject(UserManagementService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getEffectiveAccess GETs the user effective-access endpoint', () => {
    const expected: UserEffectiveAccess = {
      userId: 'u1',
      actorType: 'TenantEmployee',
      roles: ['Administrator'],
      permissionsVersion: 3,
      modules: [],
    };

    let received: UserEffectiveAccess | undefined;
    service.getEffectiveAccess('u1').subscribe((value) => (received = value));

    const request = httpMock.expectOne(`${base}/users/u1/effective-access`);
    expect(request.request.method).toBe('GET');
    request.flush(expected);

    expect(received).toEqual(expected);
  });

  it('setPermissionOverrides PUTs the deny set as { deniedPermissionIds }', () => {
    let completed = false;
    service.setPermissionOverrides('u1', ['p1', 'p2']).subscribe(() => (completed = true));

    const request = httpMock.expectOne(`${base}/users/u1/permission-overrides`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ deniedPermissionIds: ['p1', 'p2'] });
    request.flush(null);

    expect(completed).toBe(true);
  });

  it('setPermissionOverrides PUTs an empty array to clear every override', () => {
    service.setPermissionOverrides('u1', []).subscribe();

    const request = httpMock.expectOne(`${base}/users/u1/permission-overrides`);
    expect(request.request.body).toEqual({ deniedPermissionIds: [] });
    request.flush(null);
  });
});
