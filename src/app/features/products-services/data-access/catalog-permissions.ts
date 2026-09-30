import { Injectable, Signal, computed, inject } from '@angular/core';
import { AccessStore } from '@core/access/access.store';

/**
 * Claves reales del backend (`BuildingBlocks.Authorization.CatalogPermissions`), verificadas contra
 * `ItemsController` y `CategoriesController` de Catalog.Api.
 */
export const CatalogPermissionKeys = {
  Read: 'catalog.read',
  Write: 'catalog.write',
  Delete: 'catalog.delete',
  /** El stock inicial de un producto nuevo es un `POST /inventory/stock/{id}/adjust`. */
  InventoryAdjust: 'inventory.adjust',
} as const;

/**
 * Qué puede hacer el usuario en Products & Services (item 2.1). Cada señal apunta al permiso del
 * endpoint que el botón llama de verdad:
 *
 * - crear / editar ítem, cambiar precio, activar/desactivar, crear/renombrar categoría .. catalog.write
 * - borrar ítem o categoría (soft-delete) ................................................ catalog.delete
 * - cantidad inicial recibida al crear un producto ...................................... inventory.adjust
 *
 * Solo UX: el backend autoriza igual. Reactivas: se recalculan al cambiar la sesión.
 */
@Injectable({ providedIn: 'root' })
export class CatalogPermissions {
  private readonly access = inject(AccessStore);

  readonly canWrite: Signal<boolean> = computed(() => this.access.can(CatalogPermissionKeys.Write));
  readonly canDelete: Signal<boolean> = computed(() => this.access.can(CatalogPermissionKeys.Delete));
  readonly canAdjustStock: Signal<boolean> = computed(() => this.access.can(CatalogPermissionKeys.InventoryAdjust));
}
