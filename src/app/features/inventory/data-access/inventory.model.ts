/**
 * Espejos del contrato HTTP de Inventory (TaxVision.Inventory.Api, ruta `/inventory` vía
 * Gateway) + réplica mínima de Catalog + view-model de la página. El servicio Inventory NO
 * guarda nombre/SKU/precio: sus StockLevel referencian `catalogItemId` (referencia débil,
 * sin FK cross-service), así que la tabla de esta página es un JOIN client-side entre
 * GET /catalog/items (kind=Product) y GET /inventory/stock.
 *
 * Los enums viajan como STRING (JsonStringEnumConverter) y ambos servicios comparten el
 * MISMO PagedResult local `{ items, total, page, pageSize }` (no el de BuildingBlocks).
 */

// ---------- Enums del backend ----------

/**
 * Espejo de StockMovementType. Purchase/Return SUMAN, Sale/Damaged RESTAN (el backend usa
 * Math.Abs), y Adjustment/Transfer llevan una cantidad CON SIGNO (delta). Quantity=0 se
 * rechaza (inventory.invalidQuantity) y dejar stock negativo también (insufficientStock).
 */
export type StockMovementType = 'Purchase' | 'Sale' | 'Adjustment' | 'Return' | 'Transfer' | 'Damaged';

// ---------- Respuestas de Inventory ----------

/** Espejo de StockLevelDto. `isLowStock` lo deriva el server: isTracked && qty <= minLevel. */
export interface StockLevelDto {
  catalogItemId: string;
  quantityOnHand: number;
  minLevel: number;
  maxLevel: number;
  reorderPoint: number;
  isTracked: boolean;
  isLowStock: boolean;
  updatedAtUtc: string;
}

/** Espejo de StockMovementDto (ledger inmutable; hoy la UI no lo lista, queda para el detalle). */
export interface StockMovementDto {
  id: string;
  catalogItemId: string;
  type: StockMovementType;
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  reference: string | null;
  notes: string | null;
  movedAtUtc: string;
}

// ---------- Requests de Inventory ----------

/** POST /inventory/stock/{catalogItemId}/adjust — primer movimiento crea el nivel en 0 y aplica. */
export interface AdjustStockRequest {
  type: StockMovementType;
  quantity: number;
  reference: string | null;
  notes: string | null;
}

/** PUT /inventory/stock/{catalogItemId}/thresholds — negativos se recortan a 0 en el dominio. */
export interface SetStockThresholdsRequest {
  minLevel: number;
  maxLevel: number;
  reorderPoint: number;
}

// ---------- Réplica mínima de Catalog (sin imports cross-feature) ----------
// Mismo patrón que task.model.ts con /customers: se replica el subset del contrato que esta
// página necesita en vez de importar el data-access de features/products-services.

export type CatalogItemKind = 'Product' | 'Service';

export interface MoneyDto {
  amount: number;
  currency: string;
}

/**
 * Subset de CatalogItemDto. Incluye description/barcode/unit/imageUrl aunque la UI no los
 * muestre: PUT /catalog/items/{id} es un reemplazo total y hay que ecoar esos campos para
 * no borrarlos al editar.
 */
export interface CatalogItemSummary {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  sku: string | null;
  barcode: string | null;
  kind: CatalogItemKind;
  price: MoneyDto;
  cost: MoneyDto | null;
  unit: string | null;
  trackInventory: boolean;
  isActive: boolean;
  imageUrl: string | null;
}

export interface CatalogCategorySummary {
  id: string;
  name: string;
  isActive: boolean;
}

/** PagedResult local de Catalog/Inventory (campos `total`/`pageSize`, no `totalCount`/`size`). */
export interface InventoryPagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** POST /catalog/items — esta página siempre crea kind=Product con trackInventory=true. */
export interface CreateCatalogItemRequest {
  name: string;
  description: string | null;
  sku: string | null;
  barcode: string | null;
  categoryId: string;
  kind: CatalogItemKind;
  priceAmount: number;
  priceCurrency: string;
  costAmount: number | null;
  costCurrency: string | null;
  unit: string | null;
  trackInventory: boolean;
  imageUrl: string | null;
  attributes: null;
}

/** PUT /catalog/items/{id} — sin sku/kind/precio; attributes:null conserva los actuales. */
export interface UpdateCatalogItemRequest {
  name: string;
  description: string | null;
  barcode: string | null;
  categoryId: string;
  unit: string | null;
  imageUrl: string | null;
  attributes: null;
}

export interface ChangeCatalogItemPriceRequest {
  priceAmount: number;
  priceCurrency: string;
  costAmount: number | null;
  costCurrency: string | null;
}

export interface SetActiveRequest {
  isActive: boolean;
}

export interface CreateCategoryRequest {
  name: string;
  description: string | null;
  parentCategoryId: string | null;
}

// ---------- View-model de la página ----------

/** Moneda al crear productos: la UI muestra "$" fijo y el dominio exige ISO 4217. */
export const DEFAULT_CURRENCY = 'USD';

export type ProductStatus = 'active' | 'inactive';

/**
 * Nivel de stock derivado. 'untracked' es nuevo respecto al mock: un ítem de catálogo con
 * trackInventory=false no lleva ledger, así que no se le puede ajustar stock desde acá.
 */
export type StockBadge = 'untracked' | 'out' | 'low' | 'in';

/** Fila de la tabla: catálogo + stock ya joineados, con los crudos que necesita el panel. */
export interface Product {
  /** Id del CatalogItem (= catalogItemId en Inventory). */
  id: string;
  name: string;
  /** SKU para mostrar ('—' si el ítem no tiene). */
  sku: string;
  categoryId: string;
  /** Nombre de categoría resuelto contra GET /catalog/categories. */
  category: string;
  price: number;
  currency: string;
  stockQuantity: number;
  /** minLevel del backend (la UI lo llama "Low at"). */
  lowStockThreshold: number;
  /** Se conservan para ecoarlos en PUT /thresholds (la UI no los edita). */
  maxLevel: number;
  reorderPoint: number;
  /** trackInventory del catálogo: si es false no hay ajustes de stock posibles. */
  tracked: boolean;
  /** isLowStock que ya derivó el servidor (qty <= minLevel con tracking activo). */
  serverLowStock: boolean;
  status: ProductStatus;
}

/**
 * Deriva el nivel de stock de un producto. Prioriza el flag del servidor para 'low'
 * (misma regla qty <= minLevel) y agrega 'untracked' para ítems sin inventario.
 */
export function stockLevel(product: Product): StockBadge {
  if (!product.tracked) {
    return 'untracked';
  }
  if (product.stockQuantity <= 0) {
    return 'out';
  }
  if (product.serverLowStock || product.stockQuantity <= product.lowStockThreshold) {
    return 'low';
  }
  return 'in';
}

/** Lo que emite el panel de crear/editar; el store lo traduce a los requests reales. */
export interface ProductFormValue {
  name: string;
  /** Solo se aplica al crear: el SKU es inmutable en el backend. */
  sku: string;
  categoryId: string;
  price: number;
  stockQuantity: number;
  lowStockThreshold: number;
  status: ProductStatus;
}

/** JOIN CatalogItemSummary + StockLevelDto → fila de la tabla. */
export function toProduct(
  item: CatalogItemSummary,
  stock: StockLevelDto | undefined,
  categoryNameById: ReadonlyMap<string, string>,
): Product {
  return {
    id: item.id,
    name: item.name,
    sku: item.sku ?? '—',
    categoryId: item.categoryId,
    category: categoryNameById.get(item.categoryId) ?? 'Uncategorized',
    price: item.price.amount,
    currency: item.price.currency,
    // Sin fila de stock aún (ningún movimiento registrado) la cantidad real es 0.
    stockQuantity: stock?.quantityOnHand ?? 0,
    lowStockThreshold: stock?.minLevel ?? 0,
    maxLevel: stock?.maxLevel ?? 0,
    reorderPoint: stock?.reorderPoint ?? 0,
    tracked: item.trackInventory,
    serverLowStock: stock?.isLowStock ?? false,
    status: item.isActive ? 'active' : 'inactive',
  };
}
