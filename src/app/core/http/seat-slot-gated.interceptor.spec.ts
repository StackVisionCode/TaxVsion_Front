import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { SeatSlotGatedStore } from '@core/auth/seat-slot-gated.store';
import { seatSlotGatedInterceptor } from './seat-slot-gated.interceptor';

/**
 * SG-8 — el interceptor atrapa SOLO el 403 estructurado del gate de slot y navega al bloqueo.
 * Un 403 cualquiera no se toca; una navegación que ya está en `/blocked/*` no se re-dispara (G-C1).
 */
describe('seatSlotGatedInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let navigate: ReturnType<typeof vi.fn>;
  let urlValue: string;
  let store: SeatSlotGatedStore;

  beforeEach(() => {
    navigate = vi.fn().mockResolvedValue(true);
    urlValue = '/dashboard';
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([seatSlotGatedInterceptor])),
        provideHttpClientTesting(),
        {
          provide: Router,
          useValue: {
            navigate,
            get url(): string {
              return urlValue;
            },
          },
        },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(SeatSlotGatedStore);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('un 403 seats.user_slot_gated guarda el payload y navega a /blocked/seat-suspended', () => {
    let failed: HttpErrorResponse | undefined;
    http.get('/customers').subscribe({ error: err => (failed = err) });

    httpMock.expectOne('/customers').flush(
      {
        error: 'seats.user_slot_gated',
        message: 'Your seat is suspended',
        slotIndex: 11,
        effectiveCap: 10,
        contactAdminUrl: 'https://acme.taxoffix.io/account/users',
      },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(navigate).toHaveBeenCalledWith(['/blocked/seat-suspended']);
    expect(store.state()).toEqual({
      slotIndex: 11,
      effectiveCap: 10,
      contactAdminUrl: 'https://acme.taxoffix.io/account/users',
    });
    // El error sigue propagándose: la pantalla puede reaccionar también.
    expect(failed?.status).toBe(403);
  });

  it('un 403 con otro error code NO redirige ni toca el store', () => {
    http.get('/customers').subscribe({ error: () => undefined });

    httpMock.expectOne('/customers').flush(
      { code: 'Authz.PermissionDenied', error: 'authz.permission_denied' },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(navigate).not.toHaveBeenCalled();
    expect(store.state()).toBeNull();
  });

  it('un 401 corriente NO entra al interceptor', () => {
    http.get('/customers').subscribe({ error: () => undefined });

    httpMock.expectOne('/customers').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(navigate).not.toHaveBeenCalled();
  });

  it('G-C1: si ya estamos en /blocked/*, no re-dispara la navegación (loop guard)', () => {
    urlValue = '/blocked/seat-suspended';
    http.get('/dashboard-stats').subscribe({ error: () => undefined });

    httpMock.expectOne('/dashboard-stats').flush(
      { error: 'seats.user_slot_gated', slotIndex: 11, effectiveCap: 10, contactAdminUrl: '' },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(navigate).not.toHaveBeenCalled();
    // Pero el store sí recibió el payload (la pantalla puede actualizar sus números).
    expect(store.state()?.slotIndex).toBe(11);
  });

  it('G-C1: desde /logout tampoco redirige', () => {
    urlValue = '/logout';
    http.get('/notifications').subscribe({ error: () => undefined });

    httpMock.expectOne('/notifications').flush(
      { error: 'seats.user_slot_gated', slotIndex: 5, effectiveCap: 3, contactAdminUrl: '' },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(navigate).not.toHaveBeenCalled();
  });
});
