import { Injectable, Signal, computed, inject } from '@angular/core';
import { AccessStore } from '@core/access/access.store';

/**
 * Claves reales del backend (`BuildingBlocks.Authorization.CloudStoragePermissions`), verificadas
 * contra los controladores de CloudStorage — no deducidas del nombre del botón.
 */
export const CloudStoragePermissions = {
  FileView: 'cloudstorage.file.view',
  FileUpload: 'cloudstorage.file.upload',
  FileDownload: 'cloudstorage.file.download',
  FileDelete: 'cloudstorage.file.delete',
  FolderManage: 'cloudstorage.folder.manage',
  ShareCreate: 'cloudstorage.share.create',
  ShareRevoke: 'cloudstorage.share.revoke',
  ShareManage: 'cloudstorage.share.manage',
  RecycleBinManage: 'cloudstorage.recyclebin.manage',
  SettingsManage: 'cloudstorage.settings.manage',
} as const;

/**
 * B6 — qué puede hacer el usuario en Documents. Hasta acá no había NADA gateado: subir, borrar,
 * vaciar la papelera, compartir y revocar se ofrecían a todos, y el backend contestaba 403 al
 * hacer clic. Es la fila más grave de la §34 porque son acciones destructivas.
 *
 * Cada señal apunta al permiso del endpoint que el botón llama de verdad. Tres que sorprenden:
 * - **Borrar una CARPETA** no es `file.delete` sino `folder.manage`, igual que renombrar y mover.
 * - **La papelera entera** (restaurar y vaciar) va bajo `recyclebin.manage`, un permiso propio.
 * - **Descargar un zip** pide `file.download`, no `file.view`.
 */
@Injectable({ providedIn: 'root' })
export class DocumentsPermissions {
  private readonly access = inject(AccessStore);

  readonly canView: Signal<boolean> = computed(() => this.access.can(CloudStoragePermissions.FileView));
  readonly canUpload: Signal<boolean> = computed(() => this.access.can(CloudStoragePermissions.FileUpload));
  readonly canDownload: Signal<boolean> = computed(() => this.access.can(CloudStoragePermissions.FileDownload));
  readonly canDeleteFile: Signal<boolean> = computed(() => this.access.can(CloudStoragePermissions.FileDelete));

  /** Crear, renombrar, mover y BORRAR carpetas, y mover archivos entre ellas. */
  readonly canManageFolders: Signal<boolean> = computed(() =>
    this.access.can(CloudStoragePermissions.FolderManage),
  );

  readonly canShare: Signal<boolean> = computed(() => this.access.can(CloudStoragePermissions.ShareCreate));
  readonly canRevokeShare: Signal<boolean> = computed(() => this.access.can(CloudStoragePermissions.ShareRevoke));
  /** Cambiar el vencimiento o el permiso de un enlace ya creado. */
  readonly canManageShare: Signal<boolean> = computed(() => this.access.can(CloudStoragePermissions.ShareManage));

  readonly canUseRecycleBin: Signal<boolean> = computed(() =>
    this.access.can(CloudStoragePermissions.RecycleBinManage),
  );

  /** El ajuste de enlaces públicos y el uso de almacenamiento. */
  readonly canManageSettings: Signal<boolean> = computed(() =>
    this.access.can(CloudStoragePermissions.SettingsManage),
  );
}
