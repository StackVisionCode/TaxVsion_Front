import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { UserManagementService } from './user-management.service';
import { UserManagementStore } from './user-management.store';
import { PagedResult, TenantLimits, UserSummary } from './user-management.model';

function userSummary(id: string): UserSummary {
  return {
    id,
    name: 'Sofia',
    lastName: 'Martinez',
    email: `${id}@example.com`,
    actorType: 'TenantEmployee',
    isActive: true,
    status: 'Active',
    mfaEnabled: false,
    createdAtUtc: '2026-01-01T00:00:00Z',
    roles: [],
  };
}

const limits: TenantLimits = {
  planCode: 'pro',
  maxUsers: 10,
  activeUsers: 3,
  pendingInvitations: 0,
  availableSeats: 7,
  maxPendingInvitations: 5,
  storageQuotaBytes: null,
  isSuspendedForBilling: false,
  enabledModules: [],
};

/**
 * `offboardUser` es terminal en la UI: marca la fila como 'removed' (no vuelve a Suspend/Reactivate) y
 * refresca el cupo (el offboard libera el asiento). Stubs a mano (of()), sin dependencias reales.
 */
describe('UserManagementStore — offboardUser', () => {
  let store: UserManagementStore;
  let limitsCalls = 0;

  const service = {
    getUsers: (): ReturnType<UserManagementService['getUsers']> =>
      of<PagedResult<UserSummary>>({
        items: [userSummary('u1')],
        page: 1,
        size: 8,
        totalCount: 1,
        totalPages: 1,
        hasMore: false,
        hasPrevious: false,
      }),
    offboardUser: () => of(undefined as void),
    getTenantLimits: () => {
      limitsCalls++;
      return of(limits);
    },
  };

  beforeEach(() => {
    limitsCalls = 0;
    TestBed.configureTestingModule({
      providers: [
        UserManagementStore,
        { provide: UserManagementService, useValue: service },
        { provide: AuthService, useValue: { currentUser: () => null } },
      ],
    });
    store = TestBed.inject(UserManagementStore);
    store.loadMembers(1);
  });

  it('marks the member as removed after a successful offboard', () => {
    store.offboardUser('u1', 's1').subscribe();
    expect(store.members().find((member) => member.id === 'u1')?.status).toBe('removed');
  });

  it('refreshes the tenant limits (offboard frees the seat)', () => {
    store.offboardUser('u1', null).subscribe();
    expect(limitsCalls).toBeGreaterThan(0);
  });
});
