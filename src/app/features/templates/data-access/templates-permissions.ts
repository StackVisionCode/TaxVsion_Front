import { Injectable, Signal, computed, inject } from '@angular/core';
import { AccessStore } from '@core/access/access.store';

/**
 * Claves reales del backend. Las de firma y tareas se repiten como texto (y no se importan de sus
 * features) porque una feature no puede depender de otra: acá solo se usan para mostrar u ocultar
 * las tarjetas del hub, cada módulo sigue siendo dueño de sus plantillas.
 * - `NotificationPermissions` (EmailTemplatesController): view para listar/ver, manage para el resto.
 * - `SignaturePermissions.Template*` (autoría en /signature/templates).
 * - `TasksPermissions`: el modal de plantillas de tareas se abre con `tasks.write` y administrarlas
 *   pide `tasks.templates.manage`.
 */
export const TemplatesHubPermissions = {
  EmailTemplateView: 'notification.template.view',
  EmailTemplateManage: 'notification.template.manage',
  SignatureTemplateCreate: 'signature.template.create',
  SignatureTemplateUpdate: 'signature.template.update',
  SignatureTemplateDelete: 'signature.template.delete',
  TasksWrite: 'tasks.write',
  TaskTemplatesManage: 'tasks.templates.manage',
} as const;

/** Qué partes del hub de plantillas puede usar el usuario. Solo UX: el backend autoriza igual. */
@Injectable({ providedIn: 'root' })
export class TemplatesPermissions {
  private readonly access = inject(AccessStore);

  readonly canViewEmail: Signal<boolean> = computed(() =>
    this.access.can(TemplatesHubPermissions.EmailTemplateView),
  );
  /** Crear, editar, publicar y archivar plantillas de correo. */
  readonly canManageEmail: Signal<boolean> = computed(() =>
    this.access.can(TemplatesHubPermissions.EmailTemplateManage),
  );
  /** La tarjeta de firma respeta también el módulo `signatures` del plan. */
  readonly canUseSignatureTemplates: Signal<boolean> = computed(() =>
    this.access.canUse({
      module: 'signatures',
      anyOf: [
        TemplatesHubPermissions.SignatureTemplateCreate,
        TemplatesHubPermissions.SignatureTemplateUpdate,
        TemplatesHubPermissions.SignatureTemplateDelete,
      ],
    }),
  );
  readonly canUseTaskTemplates: Signal<boolean> = computed(() =>
    this.access.canUse({
      module: 'planner',
      anyOf: [TemplatesHubPermissions.TasksWrite, TemplatesHubPermissions.TaskTemplatesManage],
    }),
  );
}
