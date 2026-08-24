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
    return this.api
      .createItem({
        name: form.name.trim(),
        description: null,
        sku: null,
        barcode: null,
        categoryId: form.categoryId,
        kind: form.kind,
        priceAmount: form.price,
        priceCurrency: DEFAULT_CURRENCY,
        costAmount: null,
        costCurrency: null,
        unit: null,
        trackInventory: form.kind === 'Product',
        imageUrl: null,
        attributes: null,
      })
      .pipe(
        tap(created => {
          this._raw.update(list => [created, ...list]);
          this._total.update(total => total + 1);
        }),
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

    if (name !== baseline.name || form.categoryId !== baseline.categoryId) {
      stream = stream.pipe(
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
}
