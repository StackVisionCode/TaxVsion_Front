import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { StatusPillComponent, StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { MoneyPipe } from '@shared/pipes/money.pipe';
import { Product, ProductStatus, stockLevel } from '../../data-access/inventory.model';

/**
 * Tabla de productos (patrón "Aether", igual que invoice-table): header en
 * píldora `bg-brand-white` con extremos redondeados, columnas Product (nombre +
 * SKU) / Category (chip) / Price / Stock (cantidad + chip de nivel) / Status /
 * acciones, y un menú "..." por fila (`app-dropdown-menu`) con Edit / Adjust stock
 * (stepper inline +/-, que no cierra el menú) / Delete. Los datos vienen del join
 * Catalog+Inventory que arma el store.
 */
@Component({
  selector: 'app-product-table',
  imports: [CommonModule, DropdownMenuComponent, MenuItemDirective, StatusPillComponent, StateBlockComponent, MoneyPipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './product-table.component.html',
})
export class ProductTableComponent {
  @Input() products: Product[] = [];
  @Output() editRequested = new EventEmitter<Product>();
  @Output() adjustRequested = new EventEmitter<{ product: Product; delta: number }>();
  @Output() deleteRequested = new EventEmitter<Product>();

  trackByProductId(_index: number, product: Product): string {
    return product.id;
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

  stockTone(product: Product): StatusTone {
    switch (stockLevel(product)) {
      case 'untracked':
        return 'muted';
      case 'out':
        return 'danger';
      case 'low':
        return 'warning';
      case 'in':
        return 'success';
    }
  }

  statusLabel(status: ProductStatus): string {
    return status === 'active' ? 'Active' : 'Inactive';
  }

  statusTone(status: ProductStatus): StatusTone {
    return status === 'active' ? 'success' : 'neutral';
  }

  /** Emite un ajuste de stock (+/-) desde el stepper inline del menú, sin cerrarlo. */
  onAdjust(product: Product, delta: number): void {
    this.adjustRequested.emit({ product, delta });
  }
}
