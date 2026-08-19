import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Product, ProductTableComponent, stockLevel } from '../../ui/product-table/product-table.component';
import { ProductFormPanelComponent } from '../../ui/product-form-panel/product-form-panel.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';

type CategoryFilter = 'All' | string;

/** Categorías de productos típicas de una firma de impuestos. */
const CATEGORIES = ['Service Packages', 'Software Licenses', 'Office Supplies', 'Marketing Materials'] as const;
const PAGE_SIZE = 8;

const SEED_PRODUCTS: Product[] = [
  {
    id: 'product-1',
    name: '1040 Prep Package',
    sku: 'SVC-1040',
    category: 'Service Packages',
    price: 350,
    stockQuantity: 40,
    lowStockThreshold: 10,
    status: 'active',
  },
  {
    id: 'product-2',
    name: '1120 Business Return Package',
    sku: 'SVC-1120',
    category: 'Service Packages',
    price: 850,
    stockQuantity: 6,
    lowStockThreshold: 8,
    status: 'active',
  },
  {
    id: 'product-3',
    name: 'Bookkeeping Retainer (monthly)',
    sku: 'SVC-BOOK',
    category: 'Service Packages',
    price: 400,
    stockQuantity: 0,
    lowStockThreshold: 5,
    status: 'inactive',
  },
  {
    id: 'product-4',
    name: 'QuickBooks License (annual)',
    sku: 'LIC-QBK',
    category: 'Software Licenses',
    price: 299,
    stockQuantity: 25,
    lowStockThreshold: 10,
    status: 'active',
  },
  {
    id: 'product-5',
    name: 'Drake Tax License (seat)',
    sku: 'LIC-DRAKE',
    category: 'Software Licenses',
    price: 1595,
    stockQuantity: 3,
    lowStockThreshold: 5,
    status: 'active',
  },
  {
    id: 'product-6',
    name: 'TaxDome Add-on Seat',
    sku: 'LIC-TXD',
    category: 'Software Licenses',
    price: 60,
    stockQuantity: 0,
    lowStockThreshold: 4,
    status: 'active',
  },
  {
    id: 'product-7',
    name: 'Client Folder — Letter',
    sku: 'OFF-FLDR',
    category: 'Office Supplies',
    price: 1.25,
    stockQuantity: 420,
    lowStockThreshold: 100,
    status: 'active',
  },
  {
    id: 'product-8',
    name: 'Toner Cartridge (black)',
    sku: 'OFF-TONER',
    category: 'Office Supplies',
    price: 78,
    stockQuantity: 4,
    lowStockThreshold: 6,
    status: 'active',
  },
  {
    id: 'product-9',
    name: 'Letterhead Paper 500pk',
    sku: 'OFF-LTRHD',
    category: 'Office Supplies',
    price: 22,
    stockQuantity: 0,
    lowStockThreshold: 8,
    status: 'active',
  },
  {
    id: 'product-10',
    name: 'Branded Notepad 50pk',
    sku: 'MKT-NOTE',
    category: 'Marketing Materials',
    price: 45,
    stockQuantity: 60,
    lowStockThreshold: 15,
    status: 'active',
  },
  {
    id: 'product-11',
    name: 'Business Card Box 500ct',
    sku: 'MKT-BCARD',
    category: 'Marketing Materials',
    price: 35,
    stockQuantity: 12,
    lowStockThreshold: 12,
    status: 'active',
  },
  {
    id: 'product-12',
    name: 'Roll-up Banner Stand',
    sku: 'MKT-BANNR',
    category: 'Marketing Materials',
    price: 120,
    stockQuantity: 2,
    lowStockThreshold: 3,
    status: 'inactive',
  },
];

/**
 * Página del módulo Inventory (estilo "Aether"): stats pastel + barra de
 * filtros por categoría/búsqueda + tabla de productos + panel de
 * creación/edición dual. Reemplaza al sistema completo de inventario del CRM
 * original (proveedores, impuestos, libro de transacciones, multi-almacén)
 * por una versión visual y acotada: todo el estado vive en signals dentro de
 * esta página, sin servicios ni backend, con datos mock estáticos.
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
export class InventoryPageComponent {
  readonly products = signal<Product[]>(SEED_PRODUCTS);
  readonly categories = [...CATEGORIES];

  readonly categoryFilters: CategoryFilter[] = ['All', ...CATEGORIES];
  readonly activeCategory = signal<CategoryFilter>('All');
  readonly search = signal('');

  readonly isPanelOpen = signal(false);
  readonly editingProduct = signal<Product | null>(null);
  readonly pendingDelete = signal<Product | null>(null);

  readonly deleteMessage = computed(() => {
    const product = this.pendingDelete();
    return product ? `You're about to delete product ${product.name} (${product.sku}). This can't be undone.` : '';
  });

  readonly totalProducts = computed(() => this.products().length);

  readonly totalStockValue = computed(() =>
    this.products().reduce((sum, product) => sum + product.price * product.stockQuantity, 0),
  );

  readonly lowStockCount = computed(
    () => this.products().filter(product => stockLevel(product) !== 'in').length,
  );

  readonly categoriesCount = computed(() => new Set(this.products().map(product => product.category)).size);

  readonly visibleProducts = computed<Product[]>(() => {
    const query = this.search().trim().toLowerCase();
    const category = this.activeCategory();
    return this.products()
      .filter(product => category === 'All' || product.category === category)
      .filter(
        product =>
          !query ||
          product.name.toLowerCase().includes(query) ||
          product.sku.toLowerCase().includes(query),
      );
  });

  readonly currentPage = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly pagedProducts = computed<Product[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleProducts().slice(start, start + PAGE_SIZE);
  });

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
    this.isPanelOpen.set(true);
  }

  openEditPanel(product: Product): void {
    this.editingProduct.set(product);
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    this.isPanelOpen.set(false);
    this.editingProduct.set(null);
  }

  handleSaved(product: Product): void {
    this.products.update(list => {
      const exists = list.some(item => item.id === product.id);
      return exists ? list.map(item => (item.id === product.id ? product : item)) : [...list, product];
    });
    this.closePanel();
  }

  /** Ajusta la cantidad de stock (+/-) desde el menú de fila, sin bajar de cero. */
  adjustStock(payload: { product: Product; delta: number }): void {
    this.products.update(list =>
      list.map(item =>
        item.id === payload.product.id
          ? { ...item, stockQuantity: Math.max(0, item.stockQuantity + payload.delta) }
          : item,
      ),
    );
  }

  deleteProduct(product: Product): void {
    this.pendingDelete.set(product);
  }

  confirmDelete(): void {
    const product = this.pendingDelete();
    if (!product) {
      return;
    }
    this.products.update(list => list.filter(item => item.id !== product.id));
    this.pendingDelete.set(null);
  }
}
