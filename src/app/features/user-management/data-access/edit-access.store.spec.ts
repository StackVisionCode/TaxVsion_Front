import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { EditAccessStore } from './edit-access.store';
import { UserManagementService } from './user-management.service';
import { UserEffectiveAccess } from './user-management.model';

/**
 * The drawer's brain: it must load a user's role-granted permissions, track the admin's pending deny
 * edits (dirty vs the loaded baseline), support the per-module master-toggle, and save the whole deny
 * set — becoming clean again without a reload. These are the behaviours whose breakage would either
 * lose an admin's edit or silently over-/under-deny a real user.
 */
function sampleAccess(): UserEffectiveAccess {
  return {
    userId: 'u1',
    actorType: 'TenantEmployee',
    roles: ['Administrator'],
    permissionsVersion: 3,
    modules: [
      {
        module: 'customers',
        permissions: [
          {
            permissionId: 'p-cust-view',
            code: 'customers.view',
            module: 'customers',
            description: 'View',
            denied: false,
          },
        ],
      },
      {
        module: 'tasks',
        permissions: [
          {
            permissionId: 'p-task-view',
            code: 'tasks.view',
            module: 'tasks',
            description: 'View',
            denied: false,
          },
          {
            permissionId: 'p-task-del',
            code: 'tasks.delete',
            module: 'tasks',
            description: 'Delete',
            denied: true,
          },
        ],
      },
    ],
  };
}

class FakeUserManagementService {
  access: UserEffectiveAccess = sampleAccess();
  lastSaved: { userId: string; deniedIds: string[] } | null = null;

  getEffectiveAccess(): Observable<UserEffectiveAccess> {
    return of(this.access);
  }

  setPermissionOverrides(userId: string, deniedPermissionIds: string[]): Observable<void> {
    this.lastSaved = { userId, deniedIds: [...deniedPermissionIds] };
    return of(undefined);
  }
}

function makeStore(fake = new FakeUserManagementService()): {
  store: EditAccessStore;
  fake: FakeUserManagementService;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [EditAccessStore, { provide: UserManagementService, useValue: fake }],
  });
  return { store: TestBed.inject(EditAccessStore), fake };
}

describe('EditAccessStore', () => {
  it('hydrates the denied set from the loaded permissions and starts clean', () => {
    const { store } = makeStore();
    store.load('u1');

    expect(store.actorType()).toBe('TenantEmployee');
    expect(store.roles()).toEqual(['Administrator']);
    expect(store.permissionsVersion()).toBe(3);
    expect(store.deniedCount()).toBe(1);
    expect(store.isDenied('p-task-del')).toBe(true);
    expect(store.isDenied('p-task-view')).toBe(false);
    expect(store.dirty()).toBe(false);
  });

  it('denying a permission marks the drawer dirty and grows the count', () => {
    const { store } = makeStore();
    store.load('u1');

    store.setAllowed('p-task-view', false);

    expect(store.isDenied('p-task-view')).toBe(true);
    expect(store.deniedCount()).toBe(2);
    expect(store.dirty()).toBe(true);
  });

  it('toggling a permission back to its loaded state is clean again', () => {
    const { store } = makeStore();
    store.load('u1');

    store.toggle('p-task-del'); // allow it (was denied) -> dirty
    expect(store.isDenied('p-task-del')).toBe(false);
    expect(store.dirty()).toBe(true);

    store.toggle('p-task-del'); // deny it again -> back to baseline
    expect(store.isDenied('p-task-del')).toBe(true);
    expect(store.dirty()).toBe(false);
  });

  it('the module master-toggle denies then allows every permission in the module at once', () => {
    const { store } = makeStore();
    store.load('u1');

    store.setModuleAllowed('tasks', false);
    expect(store.isModuleFullyDenied('tasks')).toBe(true);
    expect(store.isDenied('p-task-view')).toBe(true);
    expect(store.isDenied('p-task-del')).toBe(true);

    store.setModuleAllowed('tasks', true);
    expect(store.isModuleFullyDenied('tasks')).toBe(false);
    expect(store.deniedCount()).toBe(0);
    // The other module is untouched.
    expect(store.isDenied('p-cust-view')).toBe(false);
  });

  it('reset discards pending edits back to the loaded baseline', () => {
    const { store } = makeStore();
    store.load('u1');

    store.setModuleAllowed('tasks', false);
    store.setAllowed('p-cust-view', false);
    expect(store.dirty()).toBe(true);

    store.reset();
    expect(store.deniedCount()).toBe(1);
    expect(store.isDenied('p-task-del')).toBe(true);
    expect(store.dirty()).toBe(false);
  });

  it('save PUTs the current deny set and becomes clean without a reload', () => {
    const { store, fake } = makeStore();
    store.load('u1');
    store.setAllowed('p-task-view', false); // now denying view + delete

    store.save().subscribe();

    expect(fake.lastSaved?.userId).toBe('u1');
    expect(fake.lastSaved?.deniedIds.sort()).toEqual(['p-task-del', 'p-task-view']);
    expect(store.saving()).toBe(false);
    expect(store.dirty()).toBe(false);
  });

  it('save without a loaded user throws rather than PUTting to nobody', () => {
    const { store } = makeStore();
    expect(() => store.save()).toThrow();
  });
});
