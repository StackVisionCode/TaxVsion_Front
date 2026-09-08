import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { PermissionService } from '@core/auth/permission.service';
import { ClientPermissions } from './client-permissions';

/** Fake tipado de PermissionService: controlamos permisos y actor admin. */
class FakePermissions {
  private granted = new Set<string>();
  private admin = false;
  set(perms: string[], isAdmin: boolean): void {
    this.granted = new Set(perms);
    this.admin = isAdmin;
  }
  has(p: string): boolean {
    return this.granted.has(p);
  }
  isAdmin(): boolean {
    return this.admin;
  }
}

describe('ClientPermissions (capacidades derivadas del contrato)', () => {
  let fake: FakePermissions;
  let caps: ClientPermissions;

  beforeEach(() => {
    fake = new FakePermissions();
    TestBed.configureTestingModule({
      providers: [ClientPermissions, { provide: PermissionService, useValue: fake }],
    });
    caps = TestBed.inject(ClientPermissions);
  });

  it('empleado con manage: puede crear/editar pero NO status/portal/fiscal-set/import', () => {
    fake.set(['customers.view', 'customers.manage', 'customers.preparer.manage', 'customers.fiscalprofile.reveal'], false);
    expect(caps.canView()).toBe(true);
    expect(caps.canManage()).toBe(true);
    expect(caps.canManagePreparer()).toBe(true);
    expect(caps.canRevealFiscal()).toBe(true);
    expect(caps.canChangeStatus()).toBe(false);
    expect(caps.canInvitePortal()).toBe(false);
    expect(caps.canSetFiscalProfile()).toBe(false);
    expect(caps.canImport()).toBe(false);
  });

  it('admin con manage: además status/portal/fiscal-set/import', () => {
    fake.set(['customers.view', 'customers.manage'], true);
    expect(caps.canChangeStatus()).toBe(true);
    expect(caps.canInvitePortal()).toBe(true);
    expect(caps.canSetFiscalProfile()).toBe(true);
    expect(caps.canImport()).toBe(true);
  });

  it('admin SIN manage: import sí, pero status/fiscal-set no (falta el permiso)', () => {
    fake.set([], true);
    expect(caps.canImport()).toBe(true);
    expect(caps.canChangeStatus()).toBe(false);
    expect(caps.canSetFiscalProfile()).toBe(false);
  });
});
