import { Injectable, Signal, computed, inject } from '@angular/core';
import { AccessStore } from '@core/access/access.store';

/**
 * Claves reales del backend. El servicio `TaxVision.Campaigns` tiene UN solo permiso,
 * `campaigns.manage`, en todos sus endpoints (listar incluido). El selector de plantilla del
 * formulario lee Notification (`/notifications/email/templates`), que pide `notification.template.view`.
 */
export const CampaignsPermissionKeys = {
  Manage: 'campaigns.manage',
  EmailTemplateView: 'notification.template.view',
} as const;

/** Qué puede hacer el usuario en Campaigns. Solo UX: el backend autoriza igual. */
@Injectable({ providedIn: 'root' })
export class CampaignsPermissions {
  private readonly access = inject(AccessStore);

  /** Crear, editar, enviar, agendar, archivar y borrar campañas, audiencias y remitentes. */
  readonly canManage: Signal<boolean> = computed(() => this.access.can(CampaignsPermissionKeys.Manage));
  /** Elegir una plantilla de correo al armar la campaña. */
  readonly canPickTemplates: Signal<boolean> = computed(() =>
    this.access.can(CampaignsPermissionKeys.EmailTemplateView),
  );
}
