import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  AdjustStockRequest,
  CatalogCategorySummary,
  CatalogItemSummary,
  ChangeCatalogItemPriceRequest,
  CreateCatalogItemRequest,
  CreateCategoryRequest,
  InventoryPagedResult,
  SetActiveRequest,
  SetStockThresholdsRequest,
  StockLevelDto,
  UpdateCatalogItemRequest,
} from './inventory.model';

/**
 * Cliente HTTP fino sobre StockController (`/inventory/stock`) + la réplica mínima de
 * ItemsController/CategoriesController (`/catalog`) que la página necesita para el join.
 * Tenant y usuario salen del JWT. Los endpoints de proveedores (`/inventory/suppliers`,
 * `/inventory/item-suppliers`) existen en el backend pero la UI actual no los ofrece.
 */
@Injectable({ providedIn: 'root' })
export class InventoryApiService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get stockBase(): string {
    return this.api.tenantUrl('/inventory/stock');
  }

  private get itemsBase(): string {
    return this.api.tenantUrl('/catalog/items');
  }

  private get categoriesBase(): string {
    return this.api.tenantUrl('/catalog/categories');
  }

  // ---------- Stock (Inventory.Api) ----------

  /** GET /inventory/stock — niveles del tenant, paginado `{ items, total, page, pageSize }`. */
  listStockLevels(pageSize: number, page = 1): Observable<InventoryPagedResult<StockLevelDto>> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<InventoryPagedResult<StockLevelDto>>(this.stockBase, { params });
  }

  /**
   * POST /inventory/stock/{catalogItemId}/adjust — devuelve el nivel resultante. Con
   * type=Adjustment la cantidad lleva signo (delta); 0 y stock negativo se rechazan.
   */
  adjustStock(catalogItemId: string, req: AdjustStockRequest): Observable<StockLevelDto> {
    return this.http.post<StockLevelDto>(`${this.stockBase}/${catalogItemId}/adjust`, req);
  }

  /** PUT /inventory/stock/{catalogItemId}/thresholds — crea el nivel en 0 si no existía. */
  setThresholds(catalogItemId: string, req: SetStockThresholdsRequest): Observable<StockLevelDto> {
    return this.http.put<StockLevelDto>(`${this.stockBase}/${catalogItemId}/thresholds`, req);
  }

  // ---------- Réplica mínima de Catalog (Catalog.Api) ----------

  /** GET /catalog/items — lote para el join; el backend recorta pageSize>200 a 50. */
  listCatalogItems(pageSize: number): Observable<InventoryPagedResult<CatalogItemSummary>> {
    const params = new HttpParams().set('page', 1).set('pageSize', pageSize);
    return this.http.get<InventoryPagedResult<CatalogItemSummary>>(this.itemsBase, { params });
  }

  listCategories(): Observable<CatalogCategorySummary[]> {
    return this.http.get<CatalogCategorySummary[]>(this.categoriesBase);
  }

  createItem(req: CreateCatalogItemRequest): Observable<CatalogItemSummary> {
    return this.http.post<CatalogItemSummary>(this.itemsBase, req);
  }

  updateItem(id: string, req: UpdateCatalogItemRequest): Observable<CatalogItemSummary> {
    return this.http.put<CatalogItemSummary>(`${this.itemsBase}/${id}`, req);
  }

  changePrice(id: string, req: ChangeCatalogItemPriceRequest): Observable<CatalogItemSummary> {
    return this.http.put<CatalogItemSummary>(`${this.itemsBase}/${id}/price`, req);
  }

  /** PUT /catalog/items/{id}/active — 204 sin body. */
  setItemActive(id: string, req: SetActiveRequest): Observable<void> {
    return this.http.put<void>(`${this.itemsBase}/${id}/active`, req);
  }

  /** DELETE /catalog/items/{id} — soft-delete; el ledger de stock queda huérfano server-side. */
  deleteItem(id: string): Observable<void> {
    return this.http.delete<void>(`${this.itemsBase}/${id}`);
  }

  createCategory(req: CreateCategoryRequest): Observable<CatalogCategorySummary> {
    return this.http.post<CatalogCategorySummary>(this.categoriesBase, req);
  }
}
