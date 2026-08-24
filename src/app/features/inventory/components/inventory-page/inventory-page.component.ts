import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { ProductTableComponent } from '../../ui/product-table/product-table.component';
import { ProductFormPanelComponent } from '../../ui/product-form-panel/product-form-panel.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { InventoryStore } from '../../data-access/inventory.store';
import { Product, ProductFormValue, stockLevel } from '../../data-access/inventory.model';

type CategoryFilter = 'All' | string;
const PAGE_SIZE = 8;

/**
 * Página del módulo Inventory conectada a dos servicios reales: Catalog
 * (`/catalog/items`, dueño de nombre/SKU/precio/categoría) e Inventory
 * (`/inventory/stock`, dueño de cantidades y umbrales). Solo lista kind=Product;
 * los Service viven en Products & Services. Filtros/búsqueda/paginación son
 * client-side sobre el lote traído (el listado del backend no expone búsqueda).
 */
@Component({
  selector: 'app-inventory-page',
  imports: [
    CommonModule,
    FormsModule,
    ProductTableComponent,
    ProductFormPanelComponent,
    PaginationComponent,
    ConfirmDialogComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './inventory-page.component.html',
})
export class InventoryPageComponent implements OnInit {
  readonly store = inject(InventoryStore);

  readonly activeCategory = signal<CategoryFilter>('All');
  readonly search = signal('');

  readonly isPanelOpen = signal(false);
  readonly editingProduct = signal<Product | null>(null);
  readonly panelSaving = signal(false);
  readonly panelError = signal<string | null>(null);
  readonly pendingDelete = signal<Product | null>(null);

  /** Filtros a partir de las categorías reales del backend. */
  readonly categoryFilters = computed<CategoryFilter[]>(() => [
    'All',
    ...this.store.categories().map(category => category.name),
  ]);

  readonly deleteMessage = computed(() => {
    const product = this.pendingDelete();
    return product ? `You're about to delete product ${product.name} (${product.sku}). This can't be undone.` : '';
  });

  ngOnInit(): void {
    this.store.init();
  }

  retryLoad(): void {
    this.store.refresh();
  }

  readonly totalProducts = computed(() => this.store.products().length);

  /** Solo suma los que llevan inventario: un ítem sin tracking no tiene cantidad real. */
  readonly totalStockValue = computed(() =>
    this.store
      .products()
      .filter(product => product.tracked)
      .reduce((sum, product) => sum + product.price * product.stockQuantity, 0),
  );

  readonly lowStockCount = computed(
    () =>
      this.store.products().filter(product => {
        const level = stockLevel(product);
        return level === 'low' || level === 'out';
      }).length,
  );

  readonly categoriesCount = computed(() => new Set(this.store.products().map(product => product.categoryId)).size);

  readonly visibleProducts = computed<Product[]>(() => {
    const query = this.search().trim().toLowerCase();
    const category = this.activeCategory();
    return this.store
      .products()
      .filter(product => category === 'All' || product.category === category)
      .filter(
        product =>
          !query || product.name.toLowerCase().includes(query) || product.sku.toLowerCase().includes(query),
      );
  });

  readonly currentPage = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly pagedProducts = computed<Product[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleProducts().slice(start, start + PAGE_SIZE);
  });

  readonly emptyMessage = computed(() =>
    this.store.products().length === 0
      ? 'No products yet — add your first one'
      : 'No products match your search',
  );

  setCategory(category: CategoryFilter): void {
    this.activeCategory.set(category);
    this.currentPage.set(1);
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    this.currentPage.set(1);
  }

  formatCurrency(amount: number): string {
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
  }

  openCreatePanel(): void {
    this.editingProduct.set(null);
    this.panelError.set(null);
    this.isPanelOpen.set(true);
  }

  openEditPanel(product: Product): void {
    this.editingProduct.set(product);
    this.panelError.set(null);
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    if (this.panelSaving()) {
      return;
    }
    this.isPanelOpen.set(false);
    this.editingProduct.set(null);
    this.panelError.set(null);
  }

  handleSaved(form: ProductFormValue): void {
    if (this.panelSaving()) {
      return;
    }
    this.panelSaving.set(true);
    this.panelError.set(null);
    this.store.saveProduct(this.editingProduct(), form).subscribe({
      next: () => {
        this.panelSaving.set(false);
        this.isPanelOpen.set(false);
        this.editingProduct.set(null);
      },
      error: err => {
        this.panelSaving.set(false);
        this.panelError.set(toApiError(err).message);
      },
    });
  }

  /** Alta inline de categoría: el backend exige un CategoryId válido para crear ítems. */
  handleCategoryCreated(name: string): void {
    this.store.createCategory(name).subscribe({
      error: err => this.panelError.set(toApiError(err).message),
    });
  }

  /** Stepper +/- de la fila → POST /inventory/stock/adjust (delta con signo). */
  adjustStock(payload: { product: Product; delta: number }): void {
    this.store.adjustStock(payload.product, payload.delta);
  }

  deleteProduct(product: Product): void {
    this.pendingDelete.set(product);
  }

  confirmDelete(): void {
    const product = this.pendingDelete();
    if (!product) {
      return;
    }
    this.pendingDelete.set(null);
    this.store.deleteProduct(product.id).subscribe({
      error: err => this.panelError.set(toApiError(err).message),
    });
  }

  dismissActionError(): void {
    this.store.clearActionError();
  }
}
