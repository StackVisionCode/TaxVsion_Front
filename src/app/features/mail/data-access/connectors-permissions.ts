import { Injectable, Signal, computed, inject } from '@angular/core';
import { PermissionService } from '@core/auth/permission.service';

/** Claves de permiso reales del backend (BuildingBlocks.Authorization.ConnectorsPermissions). */
export const ConnectorsPermissions = {
  AccountsWrite: 'connectors.accounts.write',
  AccountsRead: 'connectors.accounts.read',
  AccountsConnectOwn: 'connectors.accounts.connect_own',
} as const;

/**
 * Capacidades de conexión de buzón derivadas del contrato de autorización del backend
 * (AccountsController):
 *
 * - Buzón de OFICINA (compartido) — conectar/administrar exige `connectors.accounts.write` (admin).
 * - Buzón PERSONAL propio — conectar/administrar exige `connectors.accounts.connect_own` (o write).
 *
 * Reactivas: se recalculan al cambiar la sesión. Solo UX — el backend autoriza igual (revocar
 * connect_own deja el buzón usable pero oculta reauth/nuevas conexiones, que el server también negaría).
 */
@Injectable({ providedIn: 'root' })
export class ConnectorsCapabilities {
  private readonly perms = inject(PermissionService);

  /** Conectar/administrar el buzón de oficina (compartido). */
  readonly canManageOffice: Signal<boolean> = computed(() =>
    this.perms.has(ConnectorsPermissions.AccountsWrite),
  );

  /** Conectar/administrar el buzón personal propio (write lo incluye). */
  readonly canConnectOwn: Signal<boolean> = computed(() =>
    this.perms.hasAny([ConnectorsPermissions.AccountsConnectOwn, ConnectorsPermissions.AccountsWrite]),
  );
}
