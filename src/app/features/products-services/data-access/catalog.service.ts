import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  CatalogItemDto,
  CatalogPagedResult,
  CategoryDto,
  ChangeCatalogItemPriceRequest,
  CreateCatalogItemRequest,
  CreateCategoryRequest,
  SetActiveRequest,
  UpdateCatalogItemRequest,
} from './catalog.model';

interface ListItemsParams {
  categoryId?: string;
  search?: string;
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
}

/**
 * Cliente HTTP fino sobre ItemsController y CategoriesController (`/catalog` vía Gateway,
 * ruta forwardeada tal cual por YARP). Tenant y usuario salen del JWT: acá no viaja ningún
 * header extra. El paginado usa `page`/`pageSize` (no `size` como otros servicios) y el
 * backend recorta pageSize a 50 si pedís más de 200.
 */
@Injectable({ providedIn: 'root' })
export class CatalogApiService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get itemsBase(): string {
    return this.api.tenantUrl('/catalog/items');
  }

  private get categoriesBase(): string {
    return this.api.tenantUrl('/catalog/categories');
  }

  // ---------- Items ----------

  /** GET /catalog/items — paginado propio de Catalog: `{ items, total, page, pageSize }`. */
  listItems(params: ListItemsParams = {}): Observable<CatalogPagedResult<CatalogItemDto>> {
    let query = new HttpParams();
    if (params.categoryId) {
      query = query.set('categoryId', params.categoryId);
    }
    if (params.search) {
      query = query.set('search', params.search);
    }
    if (params.activeOnly) {
      query = query.set('activeOnly', true);
    }
    if (params.page) {
      query = query.set('page', params.page);
    }
    if (params.pageSize) {
      query = query.set('pageSize', params.pageSize);
    }
    return this.http.get<CatalogPagedResult<CatalogItemDto>>(this.itemsBase, { params: query });
  }

  getItem(id: string): Observable<CatalogItemDto> {
    return this.http.get<CatalogItemDto>(`${this.itemsBase}/${id}`);
  }

  createItem(req: CreateCatalogItemRequest): Observable<CatalogItemDto> {
    return this.http.post<CatalogItemDto>(this.itemsBase, req);
  }

  /** PUT /catalog/items/{id} — solo nombre/categoría/descripción/etc.; precio y SKU NO van acá. */
  updateItem(id: string, req: UpdateCatalogItemRequest): Observable<CatalogItemDto> {
    return this.http.put<CatalogItemDto>(`${this.itemsBase}/${id}`, req);
  }

  changePrice(id: string, req: ChangeCatalogItemPriceRequest): Observable<CatalogItemDto> {
    return this.http.put<CatalogItemDto>(`${this.itemsBase}/${id}/price`, req);
  }

  /** PUT /catalog/items/{id}/active — devuelve 204, sin body. */
  setItemActive(id: string, req: SetActiveRequest): Observable<void> {
    return this.http.put<void>(`${this.itemsBase}/${id}/active`, req);
  }

  /** DELETE /catalog/items/{id} — soft-delete (204); para Inventory/Billing equivale a desactivar. */
  deleteItem(id: string): Observable<void> {
    return this.http.delete<void>(`${this.itemsBase}/${id}`);
  }

  // ---------- Categorías ----------

  /** GET /catalog/categories — lista completa (sin paginar) del tenant. */
  listCategories(activeOnly = false): Observable<CategoryDto[]> {
    let query = new HttpParams();
    if (activeOnly) {
      query = query.set('activeOnly', true);
    }
    return this.http.get<CategoryDto[]>(this.categoriesBase, { params: query });
  }

  createCategory(req: CreateCategoryRequest): Observable<CategoryDto> {
    return this.http.post<CategoryDto>(this.categoriesBase, req);
  }
}
