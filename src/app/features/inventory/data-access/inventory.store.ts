import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, concatMap, forkJoin, map, of, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { InventoryApiService } from './inventory.service';
import {
  CatalogCategorySummary,
  CatalogItemSummary,
  DEFAULT_CURRENCY,
  Product,
  ProductFormValue,
  StockLevelDto,
  toProduct,
} from './inventory.model';

/** Lote de carga: el backend recorta pageSize>200 a 50, así que 200 es el máximo real. */
const FETCH_SIZE = 200;

/**
 * Store del módulo Inventory. Une dos microservicios: Catalog (`/catalog/items`, dueño de
 * nombre/SKU/precio/categoría) e Inventory (`/inventory/stock`, dueño de cantidades y
 * umbrales por catalogItemId). Guarda ambos crudos por separado y deriva las filas con
 * computed(): cualquier respuesta de stock (ajuste, thresholds) se mergea al mapa y la
 * tabla se re-arma sola. Solo muestra kind=Product: los Service del catálogo nunca llevan
 * stock (el backend fuerza trackInventory=false) y viven en Products & Services.
 */
@Injectable({ providedIn: 'root' })
export class InventoryStore {
  private readonly api = inject(InventoryApiService);

  // ---------- Estado crudo ----------
  private readonly _items = signal<CatalogItemSummary[]>([]);
  private readonly _stock = signal<ReadonlyMap<string, StockLevelDto>>(new Map());
  private readonly _categories = signal<CatalogCategorySummary[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  /** Error transitorio de una acción (ajuste de stock, borrado…): banner descartable. */
  private readonly _actionError = signal<string | null>(null);
  private initialized = false;

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly actionError = this._actionError.asReadonly();
  readonly categories = this._categories.asReadonly();

  private readonly categoryNameById = computed<ReadonlyMap<string, string>>(
    () => new Map(this._categories().map(category => [category.id, category.name])),
  );

  /** Filas de la tabla: JOIN catálogo (solo Product) + stock + nombres de categoría. */
  readonly products = computed<Product[]>(() => {
    const stock = this._stock();
    const names = this.categoryNameById();
    return this._items()
      .filter(item => item.kind === 'Product')
      .map(item => toProduct(item, stock.get(item.id), names));
  });

  // ---------- Carga ----------

  /** Carga inicial idempotente: catálogo + stock + categorías en paralelo. */
  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.refresh();
  }

  refresh(): void {
    this._loading.set(true);
    this._error.set(null);
    forkJoin({
      items: this.api.listCatalogItems(FETCH_SIZE),
      stock: this.api.listStockLevels(FETCH_SIZE),
      categories: this.api.listCategories(),
    }).subscribe({
      next: ({ items, stock, categories }) => {
        this._items.set(items.items);
        this._stock.set(new Map(stock.items.map(level => [level.catalogItemId, level])));
        this._categories.set(categories);
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  clearActionError(): void {
    this._actionError.set(null);
  }

  // ---------- Stock ----------

  /**
   * Stepper +/- de la fila → POST /adjust con type=Adjustment (delta CON SIGNO). El backend
   * rechaza quantity=0 y stock negativo (inventory.insufficientStock); no hay update
   * optimista: la fila se actualiza con el nivel que devuelve la API.
   */
  adjustStock(product: Product, delta: number): void {
    if (!product.tracked || delta === 0) {
      return;
    }
    this.api
      .adjustStock(product.id, { type: 'Adjustment', quantity: delta, reference: null, notes: null })
      .subscribe({
        next: level => this.mergeStock(level),
        error: err => this._actionError.set(toApiError(err).message),
      });
  }

  // ---------- Crear / editar / borrar ----------

  /**
   * Alta: POST /catalog/items (kind=Product, trackInventory=true) y después los follow-ups
   * de Inventory que apliquen: PUT /thresholds si hay "Low at" y POST /adjust con el stock
   * inicial (el primer movimiento crea el nivel en 0 y aplica el delta).
   */
  private createProduct(form: ProductFormValue): Observable<void> {
    const sku = form.sku.trim();
    return this.api
      .createItem({
        name: form.name.trim(),
        description: null,
        sku: sku || null,
        barcode: null,
        categoryId: form.categoryId,
        kind: 'Product',
        priceAmount: form.price,
        priceCurrency: DEFAULT_CURRENCY,
        costAmount: null,
        costCurrency: null,
        unit: null,
        trackInventory: true,
        imageUrl: null,
        attributes: null,
      })
      .pipe(
        tap(created => this._items.update(list => [created, ...list])),
        concatMap(created => {
          let chain: Observable<unknown> = of(null);
          if (form.lowStockThreshold > 0) {
            chain = chain.pipe(
              concatMap(() =>
                this.api
                  .setThresholds(created.id, {
                    minLevel: form.lowStockThreshold,
                    maxLevel: 0,
                    reorderPoint: 0,
                  })
                  .pipe(tap(level => this.mergeStock(level))),
              ),
            );
          }
          if (form.stockQuantity > 0) {
            chain = chain.pipe(
              concatMap(() =>
                this.api
                  .adjustStock(created.id, {
                    type: 'Adjustment',
                    quantity: form.stockQuantity,
                    reference: 'Initial stock',
                    notes: null,
                  })
                  .pipe(tap(level => this.mergeStock(level))),
              ),
            );
          }
          if (form.status === 'inactive') {
            chain = chain.pipe(
              concatMap(() =>
                this.api
                  .setItemActive(created.id, { isActive: false })
                  .pipe(tap(() => this.patchItem(created.id, { isActive: false }))),
              ),
            );
          }
          return chain;
        }),
        map(() => undefined),
      );
  }

  /**
   * Edición: el contrato reparte los campos en varios endpoints, así que se encadenan SOLO
   * los que cambiaron. En Catalog: PUT /{id} (nombre/categoría, ecoando descripción/barcode/
   * unit/imageUrl para no borrarlos), PUT /price y PUT /active. En Inventory: PUT /thresholds
   * (ecoando maxLevel/reorderPoint que la UI no edita) y POST /adjust con el delta que
   * resulte de editar la cantidad a mano. El SKU NO se toca: es inmutable en el backend.
   */
  private editProduct(editing: Product, form: ProductFormValue): Observable<void> {
    const baseline = this._items().find(item => item.id === editing.id);
    if (!baseline) {
      return of(undefined);
    }

    const name = form.name.trim();
    let chain: Observable<CatalogItemSummary> = of(baseline);

    if (name !== baseline.name || form.categoryId !== baseline.categoryId) {
      chain = chain.pipe(
        concatMap(latest =>
          this.api.updateItem(latest.id, {
            name,
            description: latest.description,
            barcode: latest.barcode,
            categoryId: form.categoryId,
            unit: latest.unit,
            imageUrl: latest.imageUrl,
            attributes: null,
          }),
        ),
      );
    }

    if (form.price !== baseline.price.amount) {
      chain = chain.pipe(
        concatMap(latest =>
          this.api.changePrice(latest.id, {
            priceAmount: form.price,
            priceCurrency: latest.price.currency,
            costAmount: latest.cost?.amount ?? null,
            costCurrency: latest.cost?.currency ?? null,
          }),
        ),
      );
    }

    const wantsActive = form.status === 'active';
    if (wantsActive !== baseline.isActive) {
      chain = chain.pipe(
        concatMap(latest =>
          this.api
            .setItemActive(latest.id, { isActive: wantsActive })
            .pipe(map(() => ({ ...latest, isActive: wantsActive }))),
        ),
      );
    }

    return chain.pipe(
      tap(final => this._items.update(list => list.map(item => (item.id === final.id ? final : item)))),
      concatMap(() => {
        // Follow-ups de stock: solo para ítems rastreados (los untracked no tienen ledger).
        let stockChain: Observable<unknown> = of(null);
        if (editing.tracked) {
          if (form.lowStockThreshold !== editing.lowStockThreshold) {
            stockChain = stockChain.pipe(
              concatMap(() =>
                this.api
                  .setThresholds(editing.id, {
                    minLevel: form.lowStockThreshold,
                    maxLevel: editing.maxLevel,
                    reorderPoint: editing.reorderPoint,
                  })
                  .pipe(tap(level => this.mergeStock(level))),
              ),
            );
          }
          const delta = form.stockQuantity - editing.stockQuantity;
          if (delta !== 0) {
            stockChain = stockChain.pipe(
              concatMap(() =>
                this.api
                  .adjustStock(editing.id, {
                    type: 'Adjustment',
                    quantity: delta,
                    reference: 'Manual adjustment',
                    notes: null,
                  })
                  .pipe(tap(level => this.mergeStock(level))),
              ),
            );
          }
        }
        return stockChain;
      }),
      map(() => undefined),
    );
  }

  saveProduct(editing: Product | null, form: ProductFormValue): Observable<void> {
    return editing ? this.editProduct(editing, form) : this.createProduct(form);
  }

  /** DELETE /catalog/items/{id} — soft-delete en Catalog; deja de listarse acá y en Billing. */
  deleteProduct(id: string): Observable<void> {
    return this.api.deleteItem(id).pipe(
      tap(() => this._items.update(list => list.filter(item => item.id !== id))),
      map(() => undefined),
    );
  }

  // ---------- Categorías ----------

  /**
   * Alta inline de categoría: el backend exige un CategoryId válido para crear ítems y no
   * existe página de categorías en el front, así que el panel ofrece crearla al vuelo.
   */
  createCategory(name: string): Observable<CatalogCategorySummary> {
    return this.api
      .createCategory({ name: name.trim(), description: null, parentCategoryId: null })
      .pipe(tap(created => this._categories.update(list => [...list, created])));
  }

  // ---------- Helpers ----------

  private mergeStock(level: StockLevelDto): void {
    this._stock.update(current => {
      const next = new Map(current);
      next.set(level.catalogItemId, level);
      return next;
    });
  }

  private patchItem(id: string, patch: Partial<CatalogItemSummary>): void {
    this._items.update(list => list.map(item => (item.id === id ? { ...item, ...patch } : item)));
  }
}
