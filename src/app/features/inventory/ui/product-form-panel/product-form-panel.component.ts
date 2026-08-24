import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import {
  CatalogCategorySummary,
  Product,
  ProductFormValue,
  ProductStatus,
} from '../../data-access/inventory.model';

/**
 * Overlay de creación/edición del módulo Inventory. Un único componente cubre ambos
 * modos: si `product` llega con datos precarga el formulario ("Edit Product" / "Save
 * changes"); si es null arranca vacío ("New Product" / "Add product").
 *
 * Diferencias respecto al mock, impuestas por el contrato real:
 *  - La categoría es un id (CategoryId del backend), no texto libre; el dropdown lista
 *    las categorías reales y ofrece crear una al vuelo (el alta de ítem exige una válida).
 *  - El SKU es INMUTABLE en el backend: en modo edición se muestra deshabilitado.
 *  - Al editar, el stock inicial no se toca acá (se ajusta con el stepper de la fila,
 *    que registra un movimiento real en el ledger).
 * Solo emite un ProductFormValue: las llamadas las orquesta InventoryStore.
 */
@Component({
  selector: 'app-product-form-panel',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './product-form-panel.component.html',
})
export class ProductFormPanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() product: Product | null = null;
  @Input() categories: readonly CatalogCategorySummary[] = [];
  /** Guardado en curso: deshabilita las acciones para no duplicar llamadas. */
  @Input() saving = false;
  @Input() errorMessage: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<ProductFormValue>();
  /** Alta inline de categoría; el padre la crea y la lista vuelve por @Input. */
  @Output() categoryCreated = new EventEmitter<string>();

  readonly name = signal('');
  readonly sku = signal('');
  readonly categoryId = signal('');
  readonly price = signal<number>(0);
  readonly stockQuantity = signal<number>(0);
  readonly lowStockThreshold = signal<number>(0);
  readonly status = signal<ProductStatus>('active');

  readonly isCategoryOpen = signal(false);
  readonly newCategoryName = signal('');

  /** Signal propia porque `product` es un @Input plano: un computed() no reaccionaría a sus cambios. */
  readonly isEditMode = signal(false);

  readonly categoryLabel = computed(() => {
    const id = this.categoryId();
    return this.categories.find(category => category.id === id)?.name ?? 'Select a category';
  });

  /** El SKU solo es obligatorio al crear (en edición viaja inmutable desde el backend). */
  readonly canSave = computed(
    () => this.name().trim().length > 0 && this.categoryId().length > 0 && !this.saving,
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['product'] || changes['isOpen']) {
      this.isEditMode.set(this.product !== null);
      this.resetForm();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="product-category"]')) {
      this.isCategoryOpen.set(false);
    }
  }

  toggleCategoryDropdown(): void {
    this.isCategoryOpen.set(!this.isCategoryOpen());
  }

  selectCategory(categoryId: string): void {
    this.categoryId.set(categoryId);
    this.isCategoryOpen.set(false);
  }

  createCategory(): void {
    const name = this.newCategoryName().trim();
    if (!name) {
      return;
    }
    this.categoryCreated.emit(name);
    this.newCategoryName.set('');
  }

  toggleStatus(): void {
    this.status.set(this.status() === 'active' ? 'inactive' : 'active');
  }

  close(): void {
    this.closed.emit();
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }
    this.saved.emit({
      name: this.name().trim(),
      sku: this.sku().trim(),
      categoryId: this.categoryId(),
      price: Number(this.price()) || 0,
      stockQuantity: Number(this.stockQuantity()) || 0,
      lowStockThreshold: Number(this.lowStockThreshold()) || 0,
      status: this.status(),
    });
  }

  private resetForm(): void {
    const product = this.product;
    if (product) {
      this.name.set(product.name);
      this.sku.set(product.sku === '—' ? '' : product.sku);
      this.categoryId.set(product.categoryId);
      this.price.set(product.price);
      this.stockQuantity.set(product.stockQuantity);
      this.lowStockThreshold.set(product.lowStockThreshold);
      this.status.set(product.status);
    } else {
      this.name.set('');
      this.sku.set('');
      this.categoryId.set(this.categories[0]?.id ?? '');
      this.price.set(0);
      this.stockQuantity.set(0);
      this.lowStockThreshold.set(0);
      this.status.set('active');
    }
    this.newCategoryName.set('');
    this.isCategoryOpen.set(false);
  }
}
