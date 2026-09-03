import { Injectable, Signal, computed, inject } from '@angular/core';
import { PermissionService } from '@core/auth/permission.service';

/** Claves de permiso reales del backend (BuildingBlocks.Authorization.CustomersPermissions). */
export const CustomersPermissions = {
  View: 'customers.view',
  Manage: 'customers.manage',
  PreparerManage: 'customers.preparer.manage',
  FiscalReveal: 'customers.fiscalprofile.reveal',
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

  /** Import: solo administrador del tenant (backend gatea por rol TenantAdmin). */
  readonly canImport: Signal<boolean> = computed(() => this.perms.isAdmin());
}
