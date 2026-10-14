import { Injectable, Signal, computed, inject } from '@angular/core';
import { AccessStore } from '@core/access/access.store';

/** Claves reales del backend (BuildingBlocks.Authorization.CloudStoragePermissions). */
export const CloudStorageCustomerAccess = {
  ManageAssigned: 'cloudstorage.customer_access.manage_assigned',
  ManageAny: 'cloudstorage.customer_access.manage_any',
} as const;

/**
 * Puede el usuario declarar deny per-item sobre un cliente. El backend hace el gate real;
 * esta señal solo decide si se pinta la UI del drawer.
 */
@Injectable({ providedIn: 'root' })
export class CustomerDocumentAccessPermissions {
  private readonly access = inject(AccessStore);

  readonly canManage: Signal<boolean> = computed(
    () =>
      this.access.can(CloudStorageCustomerAccess.ManageAssigned) ||
      this.access.can(CloudStorageCustomerAccess.ManageAny),
  );
}
