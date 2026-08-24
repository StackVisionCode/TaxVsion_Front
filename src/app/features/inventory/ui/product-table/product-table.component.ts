import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Input,
  Output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Product, ProductStatus, StockBadge, stockLevel } from '../../data-access/inventory.model';

/**
 * Tabla de productos (patrón "Aether", igual que invoice-table): header en
 * píldora `bg-[#FAFAFA]` con extremos redondeados, columnas Product (nombre +
 * SKU) / Category (chip) / Price / Stock (cantidad + chip de nivel) / Status /
 * acciones, y un menú fantasma "..." por fila con Edit / Adjust stock (stepper
 * inline +/-) / Delete. Los datos vienen del join Catalog+Inventory que arma el
 * store; el stepper solo aparece para ítems con trackInventory (los untracked
 * no tienen ledger en el backend). Todo el estado del menú abierto vive en una
 * signal local y se cierra al hacer click fuera (HostListener document:click).
 */
@Component({
  selector: 'app-product-table',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './product-table.component.html',
})
export class ProductTableComponent {
  @Input() products: Product[] = [];
  @Output() editRequested = new EventEmitter<Product>();
  @Output() adjustRequested = new EventEmitter<{ product: Product; delta: number }>();
  @Output() deleteRequested = new EventEmitter<Product>();

  readonly openMenuId = signal<string | null>(null);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="product-menu"]')) {
      this.openMenuId.set(null);
    }
  }

  trackByProductId(_index: number, product: Product): string {
    return product.id;
  }

  /** El precio viene como Money del backend: se formatea con SU moneda (USD por defecto). */
  formatCurrency(amount: number, currency: string): string {
    return amount.toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 2 });
  }

  level(product: Product): StockBadge {
    return stockLevel(product);
  }

  stockLabel(product: Product): string {
    switch (stockLevel(product)) {
      case 'untracked':
        return 'Not tracked';
      case 'out':
        return 'Out of stock';
      case 'low':
        return 'Low stock';
      case 'in':
        return 'In stock';
    }
  }

  stockChip(product: Product): string {
    switch (stockLevel(product)) {
      case 'untracked':
        return 'border-gray-200 text-gray-400';
      case 'out':
        return 'border-red-200 text-red-500';
      case 'low':
        return 'border-orange-200 text-orange-500';
      case 'in':
        return 'border-emerald-200 text-emerald-600';
    }
  }

  stockDot(product: Product): string {
    switch (stockLevel(product)) {
      case 'untracked':
        return 'bg-gray-300';
      case 'out':
        return 'bg-red-500';
      case 'low':
        return 'bg-orange-500';
      case 'in':
        return 'bg-emerald-500';
    }
  }

  statusLabel(status: ProductStatus): string {
    return status === 'active' ? 'Active' : 'Inactive';
  }

  statusChip(status: ProductStatus): string {
    return status === 'active' ? 'border-emerald-200 text-emerald-600' : 'border-gray-300 text-gray-500';
  }

  statusDot(status: ProductStatus): string {
    return status === 'active' ? 'bg-emerald-500' : 'bg-gray-400';
  }

  toggleMenu(product: Product, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(this.openMenuId() === product.id ? null : product.id);
  }

  onEditClick(product: Product, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.editRequested.emit(product);
  }

  /** Emite un ajuste de stock (+/-) desde el stepper inline del menú, sin cerrarlo. */
  onAdjust(product: Product, delta: number, event: MouseEvent): void {
    event.stopPropagation();
    this.adjustRequested.emit({ product, delta });
  }

  onDeleteClick(product: Product, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.deleteRequested.emit(product);
  }
}
