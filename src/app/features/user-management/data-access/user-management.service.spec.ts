import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { UserManagementService } from './user-management.service';
import { EligibleSuccessor, OffboardImpactItem, UserEffectiveAccess } from './user-management.model';

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

/**
 * Punto 3.2 — offboard (retiro terminal) + su pre-flight de impacto (fan-out a los 7 servicios) y el
 * listado de sucesores elegibles. Mismo stub de ApiConfigService: `tenantUrl(path) => http://test${path}`.
 */
describe('UserManagementService — offboarding', () => {
  let service: UserManagementService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        UserManagementService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `http://test${path}` } },
      ],
    });
    service = TestBed.inject(UserManagementService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('offboardUser POSTs the chosen successor', () => {
    service.offboardUser('u1', 's1').subscribe();
    const request = httpMock.expectOne('http://test/auth/users/u1/offboard');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ successorUserId: 's1' });
    request.flush(null);
  });

  it('offboardUser sends a null successor to route work to the office', () => {
    service.offboardUser('u1', null).subscribe();
    const request = httpMock.expectOne('http://test/auth/users/u1/offboard');
    expect(request.request.body).toEqual({ successorUserId: null });
    request.flush(null);
  });

  it('getOffboardImpact fans out to the 7 services and degrades per-service on error', () => {
    let result: OffboardImpactItem[] | undefined;
    service.getOffboardImpact('u1').subscribe((items) => (result = items));

    const flush = (path: string, field: string, count: number) => {
      const request = httpMock.expectOne(`http://test${path}/offboarding-impact/u1`);
      expect(request.request.method).toBe('GET');
      request.flush({ [field]: count });
    };
    flush('/customers', 'assignedClients', 12);
    flush('/tasks', 'openTasks', 8);
    flush('/calendar', 'futureAppointments', 3);
    flush('/correspondence', 'openDrafts', 2);
    flush('/storage', 'activeShareLinks', 4);
    // Connectors no responde → ese renglón degrada (available:false, count:0), sin tumbar el resto.
    httpMock
      .expectOne('http://test/connectors/offboarding-impact/u1')
      .error(new ProgressEvent('network error'));
    flush('/communication', 'activeMeetings', 1);

    const byKey = (key: string): OffboardImpactItem => result!.find((item) => item.key === key)!;
    expect(result!.length).toBe(7);
    expect(byKey('clients').count).toBe(12);
    expect(byKey('clients').available).toBe(true);
    expect(byKey('mailboxes').available).toBe(false);
    expect(byKey('mailboxes').count).toBe(0);
  });

  it('getEligibleSuccessors returns active staff excluding the leaver and portal users', () => {
    let result: EligibleSuccessor[] | undefined;
    service.getEligibleSuccessors('leaver').subscribe((list) => (result = list));

    const request = httpMock.expectOne(
      (r) => r.url === 'http://test/auth/users' && r.params.get('isActive') === 'true',
    );
    const user = (id: string, actorType: string, roles: string[]) => ({
      id,
      name: id === 's1' ? 'Maria' : 'X',
      lastName: id === 's1' ? 'Gonzalez' : 'Y',
      email: `${id}@example.com`,
      actorType,
      isActive: true,
      status: 'Active',
      mfaEnabled: false,
      createdAtUtc: '2026-01-01T00:00:00Z',
      roles,
    });
    request.flush({
      items: [
        user('leaver', 'TenantEmployee', ['Preparer']),
        user('s1', 'TenantAdmin', ['Administrator']),
        user('p1', 'CustomerPortal', []),
      ],
      page: 1,
      size: 100,
      totalCount: 3,
      totalPages: 1,
      hasMore: false,
      hasPrevious: false,
    });

    expect(result!.map((s) => s.id)).toEqual(['s1']);
    expect(result![0].name).toBe('Maria Gonzalez');
    expect(result![0].subtitle).toBe('Administrator');
  });
});
