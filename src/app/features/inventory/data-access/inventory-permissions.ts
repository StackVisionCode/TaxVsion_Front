import { Injectable, Signal, computed, inject } from '@angular/core';
import { AccessStore } from '@core/access/access.store';

/**
 * Claves reales del backend (`BuildingBlocks.Authorization.InventoryPermissions` y
 * `CatalogPermissions`), verificadas contra `StockController` (Inventory.Api) e `ItemsController` /
 * `CategoriesController` (Catalog.Api). La pantalla de Inventory toca los dos servicios.
 */
export const InventoryPermissionKeys = {
  Read: 'inventory.read',
  Write: 'inventory.write',
  Adjust: 'inventory.adjust',
  CatalogWrite: 'catalog.write',
  CatalogDelete: 'catalog.delete',
} as const;

/**
 * Qué puede hacer el usuario en Inventory (item 2.1):
 *
 * - alta / edición del producto (nombre, precio, categoría, activo) ....... catalog.write
 * - borrar producto (soft-delete en Catalog) .............................. catalog.delete
 * - stepper +/- y cantidad del formulario (POST /stock/{id}/adjust) ....... inventory.adjust
 * - umbral "Low at" (PUT /stock/{id}/thresholds) .......................... inventory.write
 *
 * Solo UX: el backend autoriza igual.
 */
@Injectable({ providedIn: 'root' })
export class InventoryPermissions {
  private readonly access = inject(AccessStore);

  readonly canEditProducts: Signal<boolean> = computed(() => this.access.can(InventoryPermissionKeys.CatalogWrite));
  readonly canDeleteProducts: Signal<boolean> = computed(() => this.access.can(InventoryPermissionKeys.CatalogDelete));
  readonly canAdjustStock: Signal<boolean> = computed(() => this.access.can(InventoryPermissionKeys.Adjust));
  readonly canSetThresholds: Signal<boolean> = computed(() => this.access.can(InventoryPermissionKeys.Write));
}
