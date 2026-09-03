import { Injectable, Signal, computed, inject } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * Lectura de autorización del usuario autenticado. Fuente de verdad: el `MeResponse`
 * que expone `AuthService.currentUser` (roles/permissions/actorType vienen del JWT
 * verificado por el backend). El frontend SOLO mejora la UX ocultando/deshabilitando
 * lo que el backend igualmente rechazaría — nunca reemplaza la autorización del server.
 *
 * Todo es reactivo: cada método lee la signal `currentUser`, así que un template que
 * llame `perms.has(...)` o un `effect` que dependa de él se recalcula solo al cambiar
 * la sesión (login, refresh de /me, logout).
 */
@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly auth = inject(AuthService);

  private readonly permissionSet = computed(() => new Set(this.auth.currentUser()?.permissions ?? []));
  private readonly roleSet = computed(() => new Set(this.auth.currentUser()?.roles ?? []));

  /** actorType del usuario (`TenantEmployee` | `TenantAdmin` | `PlatformAdmin` | `CustomerPortal` | …) o null si no hay sesión. */
  readonly actorType: Signal<string | null> = computed(() => this.auth.currentUser()?.actorType ?? null);

  /** Actor administrativo del tenant: varias operaciones (status, portal-invite, fiscal-set, import) lo exigen además del permiso. */
  readonly isAdmin: Signal<boolean> = computed(() => {
    const actor = this.actorType();
    return actor === 'TenantAdmin' || actor === 'PlatformAdmin';
  });

  /** True si el usuario tiene el permiso exacto (p.ej. `customers.manage`). */
  has(permission: string): boolean {
    return this.permissionSet().has(permission);
  }

  /** True si tiene al menos uno de los permisos. */
  hasAny(permissions: readonly string[]): boolean {
    const set = this.permissionSet();
    return permissions.some(p => set.has(p));
  }

  /** True si tiene todos los permisos. */
  hasAll(permissions: readonly string[]): boolean {
    const set = this.permissionSet();
    return permissions.every(p => set.has(p));
  }

  /** True si el actorType actual está entre los dados. */
  isActor(...actorTypes: readonly string[]): boolean {
    const actor = this.actorType();
    return actor !== null && actorTypes.includes(actor);
  }

  /** True si tiene el rol dado (roles[] del JWT). */
  hasRole(role: string): boolean {
    return this.roleSet().has(role);
  }
}
