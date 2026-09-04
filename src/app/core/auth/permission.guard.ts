import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PermissionService } from './permission.service';

/**
 * Factory de guard de ruta por permiso. Si el usuario no tiene el permiso, redirige al dashboard
 * en vez de dejarlo entrar a una pantalla que solo mostrará errores 403 del backend.
 *
 * Es solo UX (el backend sigue siendo la autoridad); espeja el patrón de `PermissionService`/
 * `*appHasPermission` a nivel de ruta.
 *
 * Uso en las Routes:
 *   canActivate: [permissionGuard('tasks.read')]
 */
export function permissionGuard(...permissions: readonly string[]): CanActivateFn {
  return () => {
    const perms = inject(PermissionService);
    const router = inject(Router);
    return perms.hasAny(permissions) ? true : router.createUrlTree(['/dashboard']);
  };
}
