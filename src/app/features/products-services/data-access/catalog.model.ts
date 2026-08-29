/**
 * Espejos del contrato HTTP de Catalog (TaxVision.Catalog.Api, rutas `/catalog/items` y
 * `/catalog/categories` vía Gateway) + view-model del catálogo. Los enums viajan como STRING
 * (JsonStringEnumConverter en Program.cs del servicio). OJO: Catalog define su PROPIO
 * PagedResult (`{ items, total, page, pageSize }`), distinto del de BuildingBlocks que usan
 * otros servicios (`{ items, page, size, totalCount, ... }`).
 */

// ---------- Enums del backend (TaxVision.Catalog.Domain) ----------

/** Espejo de ItemKind. Un Service nunca rastrea stock (el backend fuerza trackInventory=false). */
export type CatalogItemKind = 'Product' | 'Service';

// ---------- Respuestas ----------

/** Espejo de MoneyDto: monto + moneda ISO 4217 de 3 letras (el dominio la valida). */
export interface MoneyDto {
  amount: number;
  currency: string;
}

export interface CatalogItemAttributeDto {
  key: string;
  value: string;
  valueType: string | null;
}

/** Espejo de TaxVision.Catalog.Application.Common.CatalogItemDto (camelCase). */
export interface CatalogItemDto {
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
  attributes: CatalogItemAttributeDto[];
  createdAtUtc: string;
  updatedAtUtc: string;
}

/** Espejo de CategoryDto: las categorías son POR TENANT (árbol vía parentCategoryId), no fijas. */
export interface CategoryDto {
  id: string;
  name: string;
  description: string | null;
  parentCategoryId: string | null;
  isActive: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
}

/** PagedResult LOCAL de Catalog/Inventory: `total` y `pageSize` (no `totalCount`/`size`). */
export interface CatalogPagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------- Requests (records anidados en los controllers) ----------

export interface CatalogAttributeRequest {
  key: string;
  value: string;
  valueType: string | null;
}

/** POST /catalog/items — SKU se normaliza a MAYÚSCULAS y debe ser único por tenant (409 duplicateSku). */
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
  attributes: CatalogAttributeRequest[] | null;
}

/**
 * PUT /catalog/items/{id} — NO acepta sku, kind, precio ni trackInventory: el SKU y el tipo son
 * inmutables tras crear, y el precio va por PUT /{id}/price. `attributes: null` CONSERVA los
 * atributos actuales (una lista los reemplaza).
 */
export interface UpdateCatalogItemRequest {
  name: string;
  description: string | null;
  barcode: string | null;
  categoryId: string;
  unit: string | null;
  imageUrl: string | null;
  attributes: CatalogAttributeRequest[] | null;
}

/** PUT /catalog/items/{id}/price — si costCurrency es null el backend usa priceCurrency. */
export interface ChangeCatalogItemPriceRequest {
  priceAmount: number;
  priceCurrency: string;
  costAmount: number | null;
  costCurrency: string | null;
}

/** PUT /catalog/items/{id}/active y /catalog/categories/{id}/active (ambos devuelven 204). */
export interface SetActiveRequest {
  isActive: boolean;
}

/** POST /catalog/categories — el árbol es opcional; acá solo usamos categorías raíz. */
export interface CreateCategoryRequest {
  name: string;
  description: string | null;
  parentCategoryId: string | null;
}

// ---------- View-model del catálogo ----------

/**
 * Moneda por defecto al crear ítems: la UI muestra "$" fijo y el dominio exige ISO 4217.
 * Al editar se conserva la moneda que ya tenga el ítem.
 */
export const DEFAULT_CURRENCY = 'USD';

export type CatalogEntryStatus = 'active' | 'inactive';

/** Fila del catálogo: campos de presentación + los ids crudos que necesita el panel de edición. */
export interface CatalogEntry {
  id: string;
  name: string;
  /** SKU del backend ('—' si el ítem no tiene). */
  code: string;
  categoryId: string;
  /** Nombre de categoría resuelto contra GET /catalog/categories. */
  category: string;
  kind: CatalogItemKind;
  price: number;
  currency: string;
  /** isActive del backend (no existe "draft" en el contrato). */
  status: CatalogEntryStatus;
}

/** Lo que emite el modal de crear/editar; el store lo traduce a los requests reales. */
export interface CatalogFormValue {
  name: string;
  price: number;
  categoryId: string;
  /** Solo se aplica al crear: el kind es inmutable en el backend. */
  kind: CatalogItemKind;
  isActive: boolean;
}

/** CatalogItemDto → fila del catálogo, resolviendo el nombre de la categoría. */
export function toCatalogEntry(
  item: CatalogItemDto,
  categoryNameById: ReadonlyMap<string, string>,
): CatalogEntry {
  return {
    id: item.id,
    name: item.name,
    code: item.sku ?? '—',
    categoryId: item.categoryId,
    category: categoryNameById.get(item.categoryId) ?? 'Uncategorized',
    kind: item.kind,
    price: item.price.amount,
    currency: item.price.currency,
    status: item.isActive ? 'active' : 'inactive',
  };
}

// ---------- Paleta estable por categoría ----------
// Las categorías son dinámicas (por tenant), así que los colores no pueden ser un switch fijo:
// se asignan por hash del nombre sobre las paletas pastel del diseño "Aether".

const CATEGORY_CIRCLES = ['bg-[#E8F1FB]', 'bg-[#CFE2F7]', 'bg-[#DDE9F5]', 'bg-[#E7EAEE]'];

const CATEGORY_CHIPS = [
  'border-orange-200 text-orange-500',
  'border-indigo-200 text-indigo-600',
  'border-[#D7E3EF] text-brand-bold',
  'border-emerald-200 text-emerald-600',
];

function hashOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function categoryCircleClass(name: string): string {
  return CATEGORY_CIRCLES[hashOf(name) % CATEGORY_CIRCLES.length];
}

export function categoryChipClass(name: string): string {
  return CATEGORY_CHIPS[hashOf(name) % CATEGORY_CHIPS.length];
}

/** Icono por tipo de ítem (las categorías dinámicas no traen icono en el contrato). */
export function kindIcon(kind: CatalogItemKind): string {
  return kind === 'Product' ? 'cube-outline' : 'document-text-outline';
}
