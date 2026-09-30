import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, concatMap, forkJoin, map, of, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { CatalogApiService } from './catalog.service';
import {
  CatalogEntry,
  CatalogFormValue,
  CatalogItemDto,
  CategoryDto,
  DEFAULT_CURRENCY,
  toCatalogEntry,
} from './catalog.model';

/**
 * Lote de carga: el backend recorta pageSize>200 a 50, así que 200 es el máximo real por
 * request. Búsqueda/filtros/paginado siguen siendo locales (mismo patrón que el board de
 * Tasks): con catálogos de una firma de impuestos el lote alcanza de sobra.
 */
const FETCH_SIZE = 200;

/**
 * Store del módulo Products & Services (Catalog.Api vía /catalog). providedIn: 'root' —
 * una sola instancia para la ruta. Guarda los CatalogItemDto crudos y deriva las filas con
 * computed(): así los nombres de categoría se re-resuelven solos cuando llega el catálogo
 * de categorías (que es POR TENANT, no una lista fija).
 */
@Injectable({ providedIn: 'root' })
export class CatalogStore {
  private readonly api = inject(CatalogApiService);

  // ---------- Estado crudo ----------
  private readonly _raw = signal<CatalogItemDto[]>([]);
  private readonly _total = signal(0);
  private readonly _categories = signal<CategoryDto[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private initialized = false;

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  /** Total real del servidor (puede superar el lote cargado de FETCH_SIZE). */
  readonly total = this._total.asReadonly();
  readonly categories = this._categories.asReadonly();

  private readonly categoryNameById = computed<ReadonlyMap<string, string>>(
    () => new Map(this._categories().map(category => [category.id, category.name])),
  );

  /** Filas del catálogo con nombre de categoría resuelto. */
  readonly entries = computed<CatalogEntry[]>(() => {
    const names = this.categoryNameById();
    return this._raw().map(item => toCatalogEntry(item, names));
  });

  /** Nombres de categorías para las píldoras de filtro (solo las que existen en el tenant). */
  readonly categoryNames = computed<string[]>(() => this._categories().map(category => category.name));

  // ---------- Carga ----------

  /** Carga inicial idempotente: ítems + categorías en paralelo. */
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
      items: this.api.listItems({ pageSize: FETCH_SIZE }),
      categories: this.api.listCategories(),
    }).subscribe({
      next: ({ items, categories }) => {
        this._raw.set(items.items);
        this._total.set(items.total);
        this._categories.set(categories);
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  // ---------- Crear / editar ----------

  /**
   * Alta: un solo POST /catalog/items. trackInventory=true solo para Product (el backend
   * fuerza false en Service igualmente); SKU/costo/atributos no están en este formulario.
   */
  createEntry(form: CatalogFormValue): Observable<void> {
    // Detalles solo de producto: un servicio ignora SKU/costo/unidad/inventario.
    const isProduct = form.kind === 'Product';
    const sku = isProduct && form.sku?.trim() ? form.sku.trim() : null;
    const costAmount = isProduct && form.costAmount != null && form.costAmount > 0 ? form.costAmount : null;
    const unit = isProduct && form.unit?.trim() ? form.unit.trim() : null;
    return this.api
      .createItem({
        name: form.name.trim(),
        description: null,
        sku,
        barcode: null,
        categoryId: form.categoryId,
        kind: form.kind,
        priceAmount: form.price,
        priceCurrency: DEFAULT_CURRENCY,
        costAmount,
        costCurrency: costAmount != null ? DEFAULT_CURRENCY : null,
        unit,
        taxRateBasisPoints: Math.round((form.taxRatePercent || 0) * 100),
        trackInventory: isProduct ? (form.trackInventory ?? true) : false,
        imageUrl: null,
        attributes: null,
      })
      .pipe(
        tap(created => {
          // Prepend optimista para feedback inmediato.
          this._raw.update(list => [created, ...list]);
          this._total.update(total => total + 1);
        }),
        // Cantidad inicial recibida (solo Product con inventario): primer movimiento de stock en
        // Inventory. Falla suave — el ítem ya quedó creado; la cantidad se puede ajustar luego.
        concatMap(created => {
          const initialQty =
            isProduct && (form.trackInventory ?? true) && form.stockQuantity != null && form.stockQuantity > 0
              ? form.stockQuantity
              : 0;
          return initialQty > 0
            ? this.api.adjustInitialStock(created.id, initialQty).pipe(map(() => undefined))
            : of(undefined);
        }),
        // Reconciliación con el servidor: deja la lista consistente sin recargar la página a mano.
        tap(() => this.refresh()),
        map(() => undefined),
      );
  }

  /**
   * Edición: el contrato reparte los campos en 3 endpoints, así que se encadenan SOLO los
   * que cambiaron: PUT /{id} (nombre/categoría, ecoando descripción/barcode/unit/imageUrl
   * actuales para no borrarlos y attributes:null para conservarlos), PUT /{id}/price y
   * PUT /{id}/active (204 → se patchea el dto local a mano).
   */
  updateEntry(id: string, form: CatalogFormValue): Observable<void> {
    const baseline = this._raw().find(item => item.id === id);
    if (!baseline) {
      return of(undefined);
    }

    let stream: Observable<CatalogItemDto> = of(baseline);
    const name = form.name.trim();
    const taxBps = Math.round((form.taxRatePercent || 0) * 100);

    if (
      name !== baseline.name ||
      form.categoryId !== baseline.categoryId ||
      taxBps !== baseline.taxRateBasisPoints
    ) {
      stream = stream.pipe(
        concatMap(latest =>
          this.api.updateItem(latest.id, {
            name,
            description: latest.description,
            barcode: latest.barcode,
            categoryId: form.categoryId,
            unit: latest.unit,
            taxRateBasisPoints: taxBps,
            // Conservar el valor actual: esta pantalla no togglea el rastreo (se hace en Inventory).
            trackInventory: latest.trackInventory,
            imageUrl: latest.imageUrl,
            attributes: null,
          }),
        ),
      );
    }

    if (form.price !== baseline.price.amount) {
      stream = stream.pipe(
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

    if (form.isActive !== baseline.isActive) {
      stream = stream.pipe(
        concatMap(latest =>
          this.api
            .setItemActive(latest.id, { isActive: form.isActive })
            .pipe(map(() => ({ ...latest, isActive: form.isActive }))),
        ),
      );
    }

    return stream.pipe(
      tap(final => this._raw.update(list => list.map(item => (item.id === final.id ? final : item)))),
      map(() => undefined),
    );
  }

  /**
   * Baja de un ítem (producto O servicio): `DELETE /catalog/items/{id}` (soft-delete en Catalog).
   * Se quita de la lista local al confirmar el 204 para que desaparezca sin recargar.
   */
  deleteEntry(id: string): Observable<void> {
    return this.api.deleteItem(id).pipe(
      tap(() => {
        this._raw.update(list => list.filter(item => item.id !== id));
        this._total.update(total => Math.max(0, total - 1));
      }),
    );
  }

  // ---------- Categorías ----------

  /**
   * Alta inline de categoría: el backend exige un CategoryId válido para crear ítems y no
   * existe página de categorías en el front, así que el modal ofrece crearla al vuelo.
   */
  createCategory(name: string): Observable<CategoryDto> {
    return this.api
      .createCategory({ name: name.trim(), description: null, parentCategoryId: null })
      .pipe(tap(created => this._categories.update(list => [...list, created])));
  }

  /** Renombrar una categoría: PUT /catalog/categories/{id}; los nombres en las filas se re-resuelven solos. */
  renameCategory(id: string, name: string): Observable<CategoryDto> {
    return this.api
      .updateCategory(id, name)
      .pipe(tap(updated => this._categories.update(list => list.map(c => (c.id === id ? updated : c)))));
  }

  /**
   * Borrar una categoría: DELETE /catalog/categories/{id}. El backend la rechaza si tiene ítems
   * (el caller muestra el error). Al eliminarse, los ítems que la usaban muestran "Uncategorized".
   */
  deleteCategory(id: string): Observable<void> {
    return this.api.deleteCategory(id).pipe(tap(() => this._categories.update(list => list.filter(c => c.id !== id))));
  }
}
