import { Injectable, Signal, computed, inject } from '@angular/core';
import { AccessStore } from '@core/access/access.store';
import { AuthService } from './auth.service';

/**
 * Fachada de lectura sobre {@link AccessStore}, que es la fuente única. Se conserva la API que ya
 * usan las pantallas para no tocarlas una por una; lo que cambió es de dónde sale la respuesta.
 * El frontend SOLO mejora la UX ocultando/deshabilitando lo que el backend igualmente rechazaría —
 * nunca reemplaza la autorización del server.
 *
 * Todo es reactivo: cada método lee la signal `currentUser`, así que un template que
 * llame `perms.has(...)` o un `effect` que dependa de él se recalcula solo al cambiar
 * la sesión (login, refresh de /me, logout).
 */
@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly access = inject(AccessStore);
  private readonly auth = inject(AuthService);

  // Los roles siguen saliendo del perfil de sesión: el bootstrap de acceso no los trae, y no debería
  // — se decide por código de permission, nunca por nombre de rol.
  private readonly roleSet = computed(() => new Set(this.auth.currentUser()?.roles ?? []));

  /** actorType del usuario (`TenantEmployee` | `TenantAdmin` | `PlatformAdmin` | `CustomerPortal` | …) o null si no hay sesión. */
  readonly actorType: Signal<string | null> = this.access.actorType;

  /** Actor administrativo del tenant: varias operaciones (status, portal-invite, fiscal-set, import) lo exigen además del permiso. */
  readonly isAdmin: Signal<boolean> = this.access.isAdmin;

  /** True si el usuario tiene el permiso exacto (p.ej. `customers.manage`). */
  has(permission: string): boolean {
    return this.access.can(permission);
  }

  /** True si tiene al menos uno de los permisos. */
  hasAny(permissions: readonly string[]): boolean {
    return permissions.length > 0 && this.access.canAny(permissions);
  }

  /** True si tiene todos los permisos. */
  hasAll(permissions: readonly string[]): boolean {
    return this.access.canAll(permissions);
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
