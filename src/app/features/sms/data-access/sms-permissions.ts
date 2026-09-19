import { Injectable, Signal, computed, inject } from '@angular/core';
import { PermissionService } from '@core/auth/permission.service';

/** Claves de permiso reales del backend (BuildingBlocks.Authorization.SmsPermissions). */
export const SmsPermissions = {
  Send: 'sms.send',
  Read: 'sms.read',
  Manage: 'sms.manage',
} as const;

/**
 * Capacidades de la feature SMS derivadas del contrato real del backend:
 *
 * - ver historial / stats / bajas .... sms.read (TenantAdmin + TenantEmployee)
 * - enviar SMS/MMS ................... sms.send (TenantAdmin + TenantEmployee)
 * - gestión manual de bajas ......... sms.manage + actor Admin (solo TenantAdmin)
 *
 * Reactivas: se recalculan al cambiar la sesión. Solo UX — el backend autoriza igual.
 */
@Injectable({ providedIn: 'root' })
export class SmsCapabilities {
  private readonly perms = inject(PermissionService);

  readonly canRead: Signal<boolean> = computed(() => this.perms.has(SmsPermissions.Read));
  readonly canSend: Signal<boolean> = computed(() => this.perms.has(SmsPermissions.Send));
  readonly canManage: Signal<boolean> = computed(
    () => this.perms.has(SmsPermissions.Manage) && this.perms.isAdmin(),
  );
}
