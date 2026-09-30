import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { ServiceCatalogComponent } from '../../ui/service-catalog/service-catalog.component';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { CatalogStore } from '../../data-access/catalog.store';
import { CatalogEntry, CatalogFormValue, CatalogItemKind, CategoryDto } from '../../data-access/catalog.model';

/**
 * Página del módulo Products & Services (estilo "Aether"): stats pastel +
 * catálogo con búsqueda/filtros/toggle grid-tabla + modal de crear/editar.
 * Los datos vienen del servicio Catalog (/catalog vía Gateway) a través del
 * CatalogStore; las categorías son POR TENANT y el modal permite crearlas al
 * vuelo porque el backend exige un CategoryId válido para todo ítem.
 */
@Component({
  selector: 'app-products-services-page',
  imports: [CommonModule, FormsModule, ServiceCatalogComponent, ModalComponent, ConfirmDialogComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './products-services-page.component.html',
})
export class ProductsServicesPageComponent implements OnInit {
  readonly store = inject(CatalogStore);

  // ---------- Stats (sobre el lote cargado; el total viene del servidor) ----------

  // ---------- Filtro por tipo (pestañas Products / Services) ----------

  readonly kindFilter = signal<'all' | 'Product' | 'Service'>('all');
  readonly productCount = computed(() => this.store.entries().filter(e => e.kind === 'Product').length);
  readonly serviceCount = computed(() => this.store.entries().filter(e => e.kind === 'Service').length);
  readonly filteredEntries = computed(() => {
    const kind = this.kindFilter();
    const entries = this.store.entries();
    return kind === 'all' ? entries : entries.filter(e => e.kind === kind);
  });

  readonly activeCount = computed(() => this.store.entries().filter(s => s.status === 'active').length);
  readonly avgPrice = computed(() => {
    const services = this.store.entries();
    if (!services.length) return 0;
    return Math.round(services.reduce((sum, s) => sum + s.price, 0) / services.length);
  });

  // ---------- Modal de crear/editar ----------

  readonly isAddOpen = signal(false);
  readonly editingService = signal<CatalogEntry | null>(null);
  readonly newName = signal('');
  readonly newPrice = signal<number | null>(null);
  /** Tasa de impuesto por defecto del ítem, en % (0 = sin impuesto). La factura la toma al agregarlo. */
  readonly newTaxPercent = signal<number>(0);
  readonly newCategoryId = signal('');
  /** Kind solo editable al crear: el backend no permite cambiar el tipo de un ítem. */
  readonly newKind = signal<CatalogItemKind>('Service');
  readonly newActive = signal(true);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  // Detalles solo de Product (SKU/kind/inventario son inmutables tras crear → solo al crear).
  readonly newSku = signal('');
  readonly newCost = signal<number | null>(null);
  readonly newUnit = signal('');
  readonly newTrackInventory = signal(true);
  /** Cantidad inicial recibida (solo Product con inventario). */
  readonly newStockQuantity = signal<number | null>(null);
  /** El bloque de detalles de producto solo aplica al CREAR un Product (no en edición). */
  readonly showProductDetails = computed(() => !this.editingService() && this.newKind() === 'Product');

  // Alta inline de categoría (sin ella un tenant nuevo no podría crear su primer ítem).
  readonly newCategoryName = signal('');
  readonly creatingCategory = signal(false);

  // ---------- Gestión de categorías (crear/renombrar/eliminar) ----------
  readonly isCategoriesOpen = signal(false);
  readonly editingCategoryId = signal<string | null>(null);
  readonly editingCategoryName = signal('');
  readonly categoryError = signal<string | null>(null);
  readonly categoryBusy = signal(false);
  readonly pendingCategoryDelete = signal<CategoryDto | null>(null);
  readonly categoryDeleteMessage = computed(() => {
    const cat = this.pendingCategoryDelete();
    return cat
      ? `You're about to delete the category "${cat.name}". Items in it will show as "Uncategorized". This can't be undone.`
      : '';
  });

  // Baja (producto o servicio) con confirmación.
  readonly pendingDelete = signal<CatalogEntry | null>(null);
  readonly deleting = signal(false);
  readonly deleteMessage = computed(() => {
    const entry = this.pendingDelete();
    if (!entry) {
      return '';
    }
    const label = entry.kind === 'Product' ? 'product' : 'service';
    return `You're about to delete the ${label} "${entry.name}". It will no longer appear in billing or inventory. This can't be undone.`;
  });

  readonly canAdd = computed(
    () =>
      this.newName().trim().length > 0 &&
      (this.newPrice() ?? 0) > 0 &&
      this.newCategoryId().length > 0 &&
      !this.saving(),
  );

  ngOnInit(): void {
    // refresh() (no init()): el store es providedIn:'root' y persiste entre navegaciones; recargar en
    // cada entrada refleja ítems creados en otras páginas (p. ej. un producto creado en Inventory) sin
    // recargar el navegador.
    this.store.refresh();
  }

  openAddPanel(): void {
    this.editingService.set(null);
    this.newKind.set('Service');
    this.newActive.set(true);
    this.newTaxPercent.set(0);
    this.newSku.set('');
    this.newCost.set(null);
    this.newUnit.set('');
    this.newTrackInventory.set(true);
    this.newStockQuantity.set(null);
    // Preselecciona la primera categoría para no obligar un click extra.
    this.newCategoryId.set(this.store.categories()[0]?.id ?? '');
    this.isAddOpen.set(true);
  }

  openEditPanel(service: CatalogEntry): void {
    this.editingService.set(service);
    this.newName.set(service.name);
    this.newPrice.set(service.price);
    this.newTaxPercent.set(service.taxRatePercent);
    this.newCategoryId.set(service.categoryId);
    this.newKind.set(service.kind);
    this.newActive.set(service.status === 'active');
    this.isAddOpen.set(true);
  }

  cancelAdd(): void {
    this.isAddOpen.set(false);
    this.editingService.set(null);
    this.newName.set('');
    this.newPrice.set(null);
    this.newTaxPercent.set(0);
    this.newCategoryId.set('');
    this.newKind.set('Service');
    this.newActive.set(true);
    this.newSku.set('');
    this.newCost.set(null);
    this.newUnit.set('');
    this.newTrackInventory.set(true);
    this.newStockQuantity.set(null);
    this.newCategoryName.set('');
    this.saveError.set(null);
    this.saving.set(false);
  }

  /** POST /catalog/categories al vuelo y deja la nueva categoría seleccionada. */
  addCategory(): void {
    const name = this.newCategoryName().trim();
    if (!name || this.creatingCategory()) {
      return;
    }
    this.creatingCategory.set(true);
    this.store.createCategory(name).subscribe({
      next: created => {
        this.newCategoryId.set(created.id);
        this.newCategoryName.set('');
        this.creatingCategory.set(false);
      },
      error: err => {
        this.saveError.set(toApiError(err).message);
        this.creatingCategory.set(false);
      },
    });
  }

  // ---------- Categorías ----------

  openCategories(): void {
    this.categoryError.set(null);
    this.editingCategoryId.set(null);
    this.newCategoryName.set('');
    this.isCategoriesOpen.set(true);
  }

  closeCategories(): void {
    this.isCategoriesOpen.set(false);
    this.editingCategoryId.set(null);
    this.categoryError.set(null);
  }

  startEditCategory(cat: CategoryDto): void {
    this.editingCategoryId.set(cat.id);
    this.editingCategoryName.set(cat.name);
    this.categoryError.set(null);
  }

  cancelEditCategory(): void {
    this.editingCategoryId.set(null);
    this.editingCategoryName.set('');
  }

  saveCategory(): void {
    const id = this.editingCategoryId();
    const name = this.editingCategoryName().trim();
    if (!id || !name || this.categoryBusy()) {
      return;
    }
    this.categoryBusy.set(true);
    this.store.renameCategory(id, name).subscribe({
      next: () => {
        this.categoryBusy.set(false);
        this.editingCategoryId.set(null);
      },
      error: err => {
        this.categoryBusy.set(false);
        this.categoryError.set(toApiError(err).message);
      },
    });
  }

  requestDeleteCategory(cat: CategoryDto): void {
    this.categoryError.set(null);
    this.pendingCategoryDelete.set(cat);
  }

  confirmDeleteCategory(): void {
    const cat = this.pendingCategoryDelete();
    if (!cat || this.categoryBusy()) {
      return;
    }
    this.categoryBusy.set(true);
    this.store.deleteCategory(cat.id).subscribe({
      next: () => {
        this.categoryBusy.set(false);
        this.pendingCategoryDelete.set(null);
      },
      error: err => {
        this.categoryBusy.set(false);
        this.pendingCategoryDelete.set(null);
        this.categoryError.set(toApiError(err).message);
      },
    });
  }

  requestDelete(entry: CatalogEntry): void {
    this.pendingDelete.set(entry);
  }

  confirmDelete(): void {
    const entry = this.pendingDelete();
    if (!entry || this.deleting()) {
      return;
    }
    this.deleting.set(true);
    this.store.deleteEntry(entry.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.pendingDelete.set(null);
      },
      error: err => {
        this.deleting.set(false);
        this.pendingDelete.set(null);
        this.saveError.set(toApiError(err).message);
      },
    });
  }

  confirmAdd(): void {
    if (!this.canAdd()) {
      return;
    }
    const isProduct = this.newKind() === 'Product';
    const form: CatalogFormValue = {
      name: this.newName().trim(),
      price: this.newPrice()!,
      taxRatePercent: this.newTaxPercent() || 0,
      categoryId: this.newCategoryId(),
      kind: this.newKind(),
      isActive: this.newActive(),
      // Detalles de producto solo al crear (SKU/inventario son inmutables tras crear).
      sku: isProduct ? this.newSku().trim() || null : undefined,
      costAmount: isProduct ? this.newCost() : undefined,
      unit: isProduct ? this.newUnit().trim() || null : undefined,
      trackInventory: isProduct ? this.newTrackInventory() : undefined,
      stockQuantity: isProduct && this.newTrackInventory() ? this.newStockQuantity() : undefined,
    };
    const editing = this.editingService();
    const request$ = editing ? this.store.updateEntry(editing.id, form) : this.store.createEntry(form);

    this.saving.set(true);
    this.saveError.set(null);
    request$.subscribe({
      next: () => this.cancelAdd(),
      error: err => {
        // El modal queda abierto con el error del backend (p.ej. catalog.categoryNotFound).
        this.saveError.set(toApiError(err).message);
        this.saving.set(false);
      },
    });
  }
}
