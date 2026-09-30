import { Injectable, Signal, computed, inject } from '@angular/core';
import { PermissionService } from '@core/auth/permission.service';

/** Claves de permiso reales del backend (BuildingBlocks.Authorization.CustomersPermissions). */
export const CustomersPermissions = {
  View: 'customers.view',
  Manage: 'customers.manage',
  PreparerManage: 'customers.preparer.manage',
  FiscalReveal: 'customers.fiscalprofile.reveal',
  Import: 'customers.import',
} as const;

/**
 * Capacidades de la feature Clients derivadas del contrato real del backend. Cada
 * señal mapea una operación a su regla exacta (permiso y, cuando aplica, actor admin):
 *
 * - list/get/check-exists ............ customers.view
 * - create/edit/addresses/contacts/relations .. customers.manage
 * - status (archive/…) / bulk / portal-invite / fiscal SET .. customers.manage + actor Admin/Platform
 * - reveal SSN/EIN .................... customers.fiscalprofile.reveal (permiso propio)
 * - preparer assign/unassign ......... customers.preparer.manage
 * - import ........................... actor TenantAdmin/PlatformAdmin (rol TenantAdmin en backend)
 *
 * Reactivas: se recalculan al cambiar la sesión. Solo UX — el backend autoriza igual.
 */
@Injectable({ providedIn: 'root' })
export class ClientPermissions {
  private readonly perms = inject(PermissionService);

  readonly canView: Signal<boolean> = computed(() => this.perms.has(CustomersPermissions.View));
  readonly canManage: Signal<boolean> = computed(() => this.perms.has(CustomersPermissions.Manage));
  readonly canManagePreparer: Signal<boolean> = computed(() => this.perms.has(CustomersPermissions.PreparerManage));
  readonly canRevealFiscal: Signal<boolean> = computed(() => this.perms.has(CustomersPermissions.FiscalReveal));

  // Operaciones que además exigen actor administrativo del tenant.
  readonly canChangeStatus: Signal<boolean> = computed(
    () => this.perms.has(CustomersPermissions.Manage) && this.perms.isAdmin(),
  );
  readonly canInvitePortal: Signal<boolean> = computed(
    () => this.perms.has(CustomersPermissions.Manage) && this.perms.isAdmin(),
  );
  readonly canSetFiscalProfile: Signal<boolean> = computed(
    () => this.perms.has(CustomersPermissions.Manage) && this.perms.isAdmin(),
  );

  /** Asignar/repartir clientes a staff: permiso preparer + actor admin (el backend gatea admin-only). */
  readonly canAssignPreparer: Signal<boolean> = computed(
    () => this.perms.has(CustomersPermissions.PreparerManage) && this.perms.isAdmin(),
  );

  /** Ver el roster de asignados (columna "Assigned to" + tarjeta): solo admin/view_all (need-to-know).
   * El backend además no envía los asignados a un no-admin, así que esto solo evita pintar la columna. */
  readonly canViewAssignees: Signal<boolean> = computed(() => this.perms.isAdmin());

  /**
   * Importar clientes: SOLO el permiso. Nada de actor type.
   *
   * Dos arreglos en uno. Antes esto era `perms.isAdmin()` a secas, así que un administrador SIN
   * `customers.import` veía el botón y recibía 403, y el permiso no hacía nada en la UI. Y el
   * backend tampoco ayudaba: `CustomerImportsController` exigía además
   * `[AllowActorTypes(TenantAdmin, PlatformAdmin)]`, con lo que darle el permiso a un empleado era
   * inútil. Ese atributo ahora admite `TenantEmployee`, así que la decisión vive donde debe: en el
   * permiso, que un administrador concede con un rol custom.
   */
  readonly canImport: Signal<boolean> = computed(() => this.perms.has(CustomersPermissions.Import));
}
