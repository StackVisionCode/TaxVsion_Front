import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ClientPortalService } from './client-portal.service';
import { ClientPortalStore } from './client-portal.store';

const empty = { items: [], page: 1, size: 50, totalCount: 0, totalPages: 0, hasMore: false, hasPrevious: false };

describe('ClientPortalStore', () => {
  function create(invite: ReturnType<typeof vi.fn>) {
    const service = {
      invite,
      listInvitations: vi.fn(() => of(empty)),
      listUsers: vi.fn(() => of(empty)),
    };
    TestBed.configureTestingModule({ providers: [{ provide: ClientPortalService, useValue: service }] });
    const store = TestBed.inject(ClientPortalStore);
    store.load('customer-1', 'ana@example.com');
    return { store, service };
  }

  afterEach(() => TestBed.resetTestingModule());

  it.each(['Invited', 'Resent', 'AlreadyActive'] as const)(
    'devuelve el desenlace real del backend (%s) y refresca el estado',
    status => {
      const { store, service } = create(
        vi.fn(() => of({ customerId: 'customer-1', email: 'ana@example.com', status, expiresAtUtc: null })),
      );
      let outcome = '';

      store.invite().subscribe(value => (outcome = value));

      expect(outcome).toBe(status);
      expect(service.listInvitations).toHaveBeenCalledTimes(2);
    },
  );

  it('un rechazo llega con su motivo al componente', () => {
    const conflict = new HttpErrorResponse({
      status: 409,
      error: { code: 'Auth.PortalEmailInUse', message: 'This email already has client portal access for another client.' },
    });
    const { store } = create(vi.fn(() => throwError(() => conflict)));
    let received: unknown;

    store.invite().subscribe({ error: err => (received = err) });

    expect(received).toBe(conflict);
  });
});
