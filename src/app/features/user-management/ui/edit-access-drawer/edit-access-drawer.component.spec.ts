import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { EditAccessDrawerComponent } from './edit-access-drawer.component';
import { UserManagementService } from '../../data-access/user-management.service';
import { PermissionInfo, UserEffectiveAccess } from '../../data-access/user-management.model';
import { TeamMember } from '../user-table/user-table.component';

function member(): TeamMember {
  return {
    id: 'u1',
    kind: 'user',
    name: 'Amanda Reyes',
    initials: 'AR',
    avatarColor: 'bg-brand-bold',
    email: 'amanda@acme.com',
    roleNames: ['Preparer'],
    actorType: 'TenantEmployee',
    status: 'active',
    activity: '',
  };
}

function access(): UserEffectiveAccess {
  return {
    userId: 'u1',
    actorType: 'TenantEmployee',
    roles: ['Preparer'],
    permissionsVersion: 2,
    modules: [
      {
        module: 'tasks',
        permissions: [
          { permissionId: 'p-task-view', code: 'tasks.view', module: 'tasks', description: 'View tasks', denied: false },
          { permissionId: 'p-task-del', code: 'tasks.delete', module: 'tasks', description: 'Delete tasks', denied: true },
        ],
      },
    ],
  };
}

const catalog: PermissionInfo[] = [
  { id: 'p-task-view', code: 'tasks.view', module: 'tasks', description: 'View tasks', isCustomerPortal: false },
  { id: 'p-task-del', code: 'tasks.delete', module: 'tasks', description: 'Delete tasks', isCustomerPortal: false },
  { id: 'p-task-archive', code: 'tasks.archive', module: 'tasks', description: 'Archive tasks', isCustomerPortal: false },
];

class FakeUserManagementService {
  lastSaved: { userId: string; deniedIds: string[] } | null = null;

  getEffectiveAccess(): Observable<UserEffectiveAccess> {
    return of(access());
  }

  setPermissionOverrides(userId: string, deniedPermissionIds: string[]): Observable<void> {
    this.lastSaved = { userId, deniedIds: [...deniedPermissionIds] };
    return of(undefined);
  }
}

function setup(): { component: EditAccessDrawerComponent; fake: FakeUserManagementService } {
  const fake = new FakeUserManagementService();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [EditAccessDrawerComponent],
    providers: [{ provide: UserManagementService, useValue: fake }],
  });
  const fixture = TestBed.createComponent(EditAccessDrawerComponent);
  const component = fixture.componentInstance;
  component.member = member();
  component.catalog = catalog;
  component.ngOnInit(); // load resolves synchronously via of()
  return { component, fake };
}

describe('EditAccessDrawerComponent', () => {
  it('shows the granted permissions plus the locked "not in their roles" row', () => {
    const { component } = setup();
    const tasks = component.modules().find(module => module.key === 'tasks')!;

    expect(tasks.rows.map(row => row.code)).toContain('tasks.archive');
    expect(tasks.rows.find(row => row.code === 'tasks.archive')!.locked).toBe(true);
    expect(component.deniedCount()).toBe(1); // tasks.delete was denied on load
  });

  it('turning a permission off marks the drawer dirty and grows the restricted count', () => {
    const { component } = setup();

    component.setAllowed('p-task-view', false);

    expect(component.isDenied('p-task-view')).toBe(true);
    expect(component.deniedCount()).toBe(2);
    expect(component.dirty()).toBe(true);
  });

  it('the module master toggle restricts every granted permission in the module', () => {
    const { component } = setup();
    const tasks = component.modules().find(module => module.key === 'tasks')!;

    component.setModuleAllowed(tasks, false);

    expect(component.moduleAllowed(tasks)).toBe(false);
    expect(component.moduleDeniedCount(tasks)).toBe(2);
    expect(component.isDenied('p-task-view')).toBe(true);
    expect(component.isDenied('p-task-del')).toBe(true);
  });

  it('save sends the denied set as the payload and emits saved', () => {
    const { component, fake } = setup();
    let savedEmitted = false;
    component.saved.subscribe(() => (savedEmitted = true));

    component.setAllowed('p-task-view', false); // restricting view + delete
    component.onSave();

    expect(fake.lastSaved?.userId).toBe('u1');
    expect(fake.lastSaved?.deniedIds.sort()).toEqual(['p-task-del', 'p-task-view']);
    expect(savedEmitted).toBe(true);
  });

  it('does not save when nothing changed', () => {
    const { component, fake } = setup();

    component.onSave();

    expect(fake.lastSaved).toBeNull();
  });
});
