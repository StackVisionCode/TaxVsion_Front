import { Injectable, Signal, computed, inject } from '@angular/core';
import { AccessStore } from '@core/access/access.store';

/**
 * Claves reales del backend (`BuildingBlocks.Authorization.SignaturePermissions`), leídas de los
 * controladores de Signature endpoint por endpoint.
 */
export const SignaturePermissions = {
  RequestCreate: 'signature.request.create',
  RequestRead: 'signature.request.read',
  RequestCancel: 'signature.request.cancel',
  RequestResend: 'signature.request.resend',
  RequestExpire: 'signature.request.expire',
  DocumentPrepare: 'signature.document.prepare',
  DocumentSign: 'signature.document.sign',
  DocumentSend: 'signature.document.send',
  TemplateCreate: 'signature.template.create',
  TemplateUpdate: 'signature.template.update',
  TemplateDelete: 'signature.template.delete',
  PreparerManage: 'signature.preparer.manage',
} as const;

/**
 * B6 — las acciones de Signature. La cabecera y los botones de fila se mostraban solo según el
 * ESTADO de la solicitud, nunca según lo que el usuario puede hacer, así que "Cancel" y "Extend"
 * terminaban en 403.
 *
 * Tres separaciones del backend que la UI no reflejaba y que no son intercambiables:
 * - **Cancelar** (`request.cancel`) y **extender el vencimiento** (`request.expire`) son permisos
 *   distintos: darle más días a una solicitud no es lo mismo que matarla.
 * - **Reenviarle el correo a un firmante** (`request.resend`) tampoco es ninguno de los dos.
 * - Las **categorías** no tienen permiso propio: van bajo `request.create`.
 */
@Injectable({ providedIn: 'root' })
export class SignatureCapabilities {
  private readonly access = inject(AccessStore);

  readonly canRead: Signal<boolean> = computed(() => this.access.can(SignaturePermissions.RequestRead));

  /** Crear y editar solicitudes, firmantes, PIN, preparador asignado y CATEGORÍAS. */
  readonly canCreate: Signal<boolean> = computed(() => this.access.can(SignaturePermissions.RequestCreate));

  readonly canCancel: Signal<boolean> = computed(() => this.access.can(SignaturePermissions.RequestCancel));
  readonly canExtend: Signal<boolean> = computed(() => this.access.can(SignaturePermissions.RequestExpire));
  readonly canResend: Signal<boolean> = computed(() => this.access.can(SignaturePermissions.RequestResend));

  /** Colocar campos sobre el PDF (del firmante y del preparador). */
  readonly canPrepare: Signal<boolean> = computed(() => this.access.can(SignaturePermissions.DocumentPrepare));
  /** Firmar como preparador. */
  readonly canSign: Signal<boolean> = computed(() => this.access.can(SignaturePermissions.DocumentSign));
  readonly canDeliverCopies: Signal<boolean> = computed(() => this.access.can(SignaturePermissions.DocumentSend));

  /** Editar una plantilla: metadatos, slots, campos, publicar y volver a borrador. */
  readonly canEditTemplates: Signal<boolean> = computed(() =>
    this.access.can(SignaturePermissions.TemplateUpdate),
  );
  readonly canCreateTemplates: Signal<boolean> = computed(() =>
    this.access.can(SignaturePermissions.TemplateCreate),
  );
  /** Archivar una plantilla tiene permiso propio, distinto de editarla. */
  readonly canArchiveTemplates: Signal<boolean> = computed(() =>
    this.access.can(SignaturePermissions.TemplateDelete),
  );

  /** Los perfiles de firma del preparador ("My signature"). */
  readonly canManagePreparerProfiles: Signal<boolean> = computed(() =>
    this.access.can(SignaturePermissions.PreparerManage),
  );
}
