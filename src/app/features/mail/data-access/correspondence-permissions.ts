import { Injectable, Signal, computed, inject } from '@angular/core';
import { AccessStore } from '@core/access/access.store';

/** Claves reales del backend (`BuildingBlocks.Authorization.CorrespondencePermissions`). */
export const CorrespondencePermissions = {
  Read: 'correspondence.read',
  AttachmentDownload: 'correspondence.attachment.download',
  Compose: 'correspondence.compose',
  Reply: 'correspondence.reply',
  Send: 'correspondence.send',
  Manage: 'correspondence.manage',
} as const;

/**
 * B6 — qué puede hacer el usuario con el correo.
 *
 * La separación que importa: mover a la papelera, restaurar y **borrar para siempre** NO son
 * `compose` ni `read`, son `correspondence.manage`. La §34 lo marcaba como "Delete forever visible
 * → 403 para el empleado": el botón más destructivo de la pantalla se ofrecía a todos.
 *
 * Redactar, responder y enviar también están separados en el backend: se puede tener el borrador
 * sin poder mandarlo.
 */
@Injectable({ providedIn: 'root' })
export class CorrespondenceCapabilities {
  private readonly access = inject(AccessStore);

  readonly canRead: Signal<boolean> = computed(() => this.access.can(CorrespondencePermissions.Read));
  readonly canCompose: Signal<boolean> = computed(() => this.access.can(CorrespondencePermissions.Compose));
  readonly canReply: Signal<boolean> = computed(() => this.access.can(CorrespondencePermissions.Reply));
  readonly canSend: Signal<boolean> = computed(() => this.access.can(CorrespondencePermissions.Send));
  readonly canDownloadAttachments: Signal<boolean> = computed(() =>
    this.access.can(CorrespondencePermissions.AttachmentDownload),
  );

  /** Papelera, restaurar, archivar y borrar para siempre. */
  readonly canManage: Signal<boolean> = computed(() => this.access.can(CorrespondencePermissions.Manage));
}
