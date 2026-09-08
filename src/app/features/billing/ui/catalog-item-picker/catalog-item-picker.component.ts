import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { BillingCatalogItem } from '../../data-access/billing.model';

/**
 * Selector de producto/servicio del catálogo del tenant, equivalente al "Add Products & Services"
 * del CRM legado pero contra `/catalog/items` de verdad.
 *
 * Vale la pena porque `InvoiceLineInput` acepta `catalogItemId`: la línea queda trazada al ítem
 * real en vez de ser texto suelto. El precio y la descripción se copian (se "congelan") en la
 * factura, que es exactamente lo que hace el backend con las líneas.
 *
 * No muestra stock: Inventory es otro servicio y la factura no descuenta existencias (el legado sí
 * lo hacía, con un TODO admitiendo que el enum de movimiento estaba a medias).
 */
@Component({
  selector: 'app-catalog-item-picker',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './catalog-item-picker.component.html',
})
export class CatalogItemPickerComponent {
  @Input() isOpen = false;
  @Input() items: BillingCatalogItem[] = [];
  @Input() searching = false;

  @Output() closed = new EventEmitter<void>();
  @Output() searchChanged = new EventEmitter<string>();
  @Output() itemPicked = new EventEmitter<BillingCatalogItem>();

  readonly query = signal('');

  onQuery(value: string): void {
    this.query.set(value);
    this.searchChanged.emit(value);
  }

  price(item: BillingCatalogItem): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: item.price?.currency || 'USD',
      minimumFractionDigits: 2,
    }).format(item.price?.amount ?? 0);
  }

  close(): void {
    this.closed.emit();
  }
}
