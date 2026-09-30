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
    // Sin `customers.import` no se ofrece, tenga o no manage.
    expect(caps.canImport()).toBe(false);
  });

  it('admin con manage e import: status/portal/fiscal-set/import', () => {
    fake.set(['customers.view', 'customers.manage', 'customers.import'], true);
    expect(caps.canChangeStatus()).toBe(true);
    expect(caps.canInvitePortal()).toBe(true);
    expect(caps.canSetFiscalProfile()).toBe(true);
    expect(caps.canImport()).toBe(true);
  });

  it('admin SIN el permiso de import: NO se le ofrece importar', () => {
    // Antes bastaba con ser admin y el botón daba 403: `CustomerImportsController` exige
    // `[HasPermission(customers.import)]` ADEMÁS del actor type.
    fake.set([], true);
    expect(caps.canImport()).toBe(false);
    expect(caps.canChangeStatus()).toBe(false);
    expect(caps.canSetFiscalProfile()).toBe(false);
  });

  it('empleado CON el permiso de import: SÍ puede', () => {
    // La decisión vive en el permiso. `CustomerImportsController` admite TenantEmployee, así que un
    // rol custom con `customers.import` habilita la importación de verdad.
    fake.set(['customers.view', 'customers.import'], false);
    expect(caps.canImport()).toBe(true);
  });
});
