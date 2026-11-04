import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { OffboardImpactService } from './offboard-impact.service';
import { OffboardImpactItem } from './user-management.model';

describe('OffboardImpactService', () => {
  let service: OffboardImpactService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `http://test${path}` } },
      ],
    });
    service = TestBed.inject(OffboardImpactService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  /** Lo que hoy declara Auth (`GET /auth/offboarding/participants`), más un servicio sin texto propio. */
  const participants = [
    { service: 'Customer', module: 'Clients', impactPath: '/customers/offboarding-impact/{userId}', acceptsEmail: false },
    { service: 'Tasks', module: 'Tasks and client forms', impactPath: '/tasks/offboarding-impact/{userId}', acceptsEmail: false },
    { service: 'CloudStorage', module: 'Files and cloud storage', impactPath: '/storage/offboarding-impact/{userId}', acceptsEmail: true },
    { service: 'Connectors', module: 'Mailboxes', impactPath: '/connectors/offboarding-impact/{userId}', acceptsEmail: true },
    { service: 'Tenant', module: 'Office settings', impactPath: '/tenants/offboarding-impact/{userId}', acceptsEmail: false },
    { service: 'Billing', module: 'Billing', impactPath: '/billing/offboarding-impact/{userId}', acceptsEmail: false },
  ];

  it('getOffboardImpact asks only the services Auth lists, splits counts into rows and degrades per service', () => {
    let result: OffboardImpactItem[] | undefined;
    service.getOffboardImpact('u1', 'ana@example.com').subscribe((items) => (result = items));

    httpMock.expectOne('http://test/auth/offboarding/participants').flush(participants);

    const flush = (path: string, body: Record<string, number | boolean>) => {
      const request = httpMock.expectOne((r) => r.url === `http://test${path}/offboarding-impact/u1`);
      // Solo los servicios que reconocen por email lo reciben, y en el cuerpo (nunca en la URL).
      if (path === '/storage') {
        expect(request.request.method).toBe('POST');
        expect(request.request.body).toEqual({ email: 'ana@example.com' });
      } else {
        expect(request.request.method).toBe('GET');
      }
      expect(request.request.urlWithParams).not.toContain('@');
      request.flush(body);
    };
    flush('/customers', { assignedClients: 14, primaryClients: 12, additionalAccess: 2, archivedClients: 1 });
    flush('/tasks', { openTasks: 8, intakeLinks: 1 });
    flush('/storage', { activeShareLinks: 4, officeCloudConnections: 1 });
    // Connectors no responde → sus renglones degradan (available:false, count:0), sin tumbar el resto.
    const connectors = httpMock.expectOne((r) => r.url === 'http://test/connectors/offboarding-impact/u1');
    expect(connectors.request.method).toBe('POST');
    connectors.error(new ProgressEvent('network error'));
    flush('/tenants', { isSecurityCoordinator: true });
    // Servicio nuevo sin texto en el CRM: un renglón genérico con su área y el mayor conteo (no la suma).
    flush('/billing', { openInvoices: 3, total: 5 });

    const byKey = (key: string): OffboardImpactItem => result!.find((item) => item.key === key)!;
    expect(byKey('clients').count).toBe(12);
    expect(byKey('clientAccess').count).toBe(2);
    expect(byKey('intakeLinks').count).toBe(1);
    // Un campo que el servicio no manda cuenta 0; un booleano cuenta 1.
    expect(byKey('formRequests').count).toBe(0);
    expect(byKey('wispCoordinator').count).toBe(1);
    expect(byKey('cloudConnections').count).toBe(1);
    expect(byKey('officeMailboxes').available).toBe(false);
    expect(byKey('mailboxes').count).toBe(0);
    expect(byKey('service:Billing')).toEqual(expect.objectContaining({ count: 5, label: 'items in Billing', available: true }));
    // Un servicio que no está en la lista de Auth no se consulta.
    expect(result!.some((item) => item.key === 'appointments')).toBe(false);
  });

  it('getOffboardImpact reports the preview as unavailable when Auth cannot list the services', () => {
    let result: OffboardImpactItem[] | undefined;
    service.getOffboardImpact('u1', 'ana@example.com').subscribe((items) => (result = items));

    httpMock.expectOne('http://test/auth/offboarding/participants').flush('down', { status: 503, statusText: 'Unavailable' });

    expect(result).toHaveLength(1);
    expect(result![0].available).toBe(false);
  });

  it('getStatus reads the handover progress from Auth', () => {
    let completed: number | undefined;
    service.getStatus('u1').subscribe((status) => (completed = status.completed));

    httpMock.expectOne('http://test/auth/users/u1/offboarding-status').flush({
      status: 'Completed',
      expected: 2,
      completed: 2,
      pending: [],
      startedAtUtc: '2026-11-03T10:00:00Z',
      completedAtUtc: '2026-11-03T10:00:05Z',
    });

    expect(completed).toBe(2);
  });
});
