import { Injectable, Signal, computed, inject } from '@angular/core';
import { AccessStore } from '@core/access/access.store';

/** Claves reales del backend (Auth `PermissionCatalog` + Subscription). */
export const UserManagementPermissions = {
  UsersView: 'users.view',
  UsersInvite: 'users.invite',
  UsersManage: 'users.manage',
  RolesManage: 'roles.manage',
  SeatsManage: 'seats.manage',
  AddOnsManage: 'addons.manage',
} as const;

/**
 * B6 — la pantalla de usuarios y roles. La §34 la marcaba entera: "todo visible", con errores
 * rojos o silenciosos para el empleado.
 *
 * Cuatro permisos distintos y ninguno implica al otro:
 * - `users.view` para ver la lista,
 * - `users.invite` para invitar (y reenviar la invitación),
 * - `users.manage` para suspender y dar de baja,
 * - `roles.manage` para tocar roles y overrides.
 *
 * Los puestos son de Subscription (`seats.manage`), que es otra cosa: comprar puestos cuesta
 * dinero y no tiene por qué venir con poder invitar.
 */
@Injectable({ providedIn: 'root' })
export class UserManagementCapabilities {
  private readonly access = inject(AccessStore);

  readonly canView: Signal<boolean> = computed(() => this.access.can(UserManagementPermissions.UsersView));
  readonly canInvite: Signal<boolean> = computed(() => this.access.can(UserManagementPermissions.UsersInvite));
  /** Suspender, reactivar y dar de baja. */
  readonly canManageUsers: Signal<boolean> = computed(() =>
    this.access.can(UserManagementPermissions.UsersManage),
  );
  readonly canManageRoles: Signal<boolean> = computed(() =>
    this.access.can(UserManagementPermissions.RolesManage),
  );
  readonly canManageSeats: Signal<boolean> = computed(() =>
    this.access.can(UserManagementPermissions.SeatsManage),
  );
  readonly canManageAddOns: Signal<boolean> = computed(() =>
    this.access.can(UserManagementPermissions.AddOnsManage),
  );
}
