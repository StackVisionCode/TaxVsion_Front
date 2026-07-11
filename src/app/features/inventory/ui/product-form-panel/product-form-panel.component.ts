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
import { Product, ProductStatus } from '../product-table/product-table.component';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';

/**
 * Overlay de creación/edición del módulo Inventory (mismo patrón que
 * task-create-panel): tarjeta centrada `rounded-[28px]` sobre backdrop con
 * stopPropagation. Un único componente cubre ambos modos: si `product` llega
 * con datos precarga el formulario y actúa como edición ("Edit Product" /
 * "Save changes"); si es null arranca vacío ("New Product" / "Add product").
 * El selector de categoría es una píldora con dropdown propio que se cierra al
 * hacer click fuera.
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
  @Input() categories: string[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Product>();

  readonly name = signal('');
  readonly sku = signal('');
  readonly category = signal('');
  readonly price = signal<number>(0);
  readonly stockQuantity = signal<number>(0);
  readonly lowStockThreshold = signal<number>(0);
  readonly status = signal<ProductStatus>('active');

  readonly isCategoryOpen = signal(false);

  /** Signal propia porque `product` es un @Input plano: un computed() no reaccionaría a sus cambios. */
  readonly isEditMode = signal(false);
  readonly canSave = computed(() => this.name().trim().length > 0 && this.sku().trim().length > 0 && !!this.category());

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

  selectCategory(category: string): void {
    this.category.set(category);
    this.isCategoryOpen.set(false);
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
    const result: Product = {
      id: this.product?.id ?? `product-${Date.now()}`,
      name: this.name().trim(),
      sku: this.sku().trim(),
      category: this.category(),
      price: Number(this.price()) || 0,
      stockQuantity: Number(this.stockQuantity()) || 0,
      lowStockThreshold: Number(this.lowStockThreshold()) || 0,
      status: this.status(),
    };
    this.saved.emit(result);
  }

  private resetForm(): void {
    const product = this.product;
    if (product) {
      this.name.set(product.name);
      this.sku.set(product.sku);
      this.category.set(product.category);
      this.price.set(product.price);
      this.stockQuantity.set(product.stockQuantity);
      this.lowStockThreshold.set(product.lowStockThreshold);
      this.status.set(product.status);
    } else {
      this.name.set('');
      this.sku.set('');
      this.category.set(this.categories[0] ?? '');
      this.price.set(0);
      this.stockQuantity.set(0);
      this.lowStockThreshold.set(0);
      this.status.set('active');
    }
    this.isCategoryOpen.set(false);
  }
}
