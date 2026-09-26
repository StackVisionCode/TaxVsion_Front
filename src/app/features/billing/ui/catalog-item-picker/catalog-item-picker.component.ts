import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { BillingCatalogItem } from '../../data-access/billing.model';

/** Payload del alta rápida desde el picker (el resto de campos los completa el formulario). */
export interface CatalogQuickCreate {
  name: string;
  kind: 'Product' | 'Service';
  price: number;
  /** Impuesto por defecto en % (0 = sin impuesto). */
  taxPercent: number;
  /** Solo Product (undefined para Service). */
  sku?: string | null;
  cost?: number | null;
  unit?: string | null;
  trackInventory?: boolean;
}

/**
 * Selector de producto/servicio del catálogo del tenant, equivalente al "Add Products & Services"
 * del CRM legado pero contra `/catalog/items` de verdad.
 *
 * Vale la pena porque `InvoiceLineInput` acepta `catalogItemId`: la línea queda trazada al ítem
 * real en vez de ser texto suelto. El precio y la descripción se copian (se "congelan") en la
 * factura, que es exactamente lo que hace el backend con las líneas.
 *
 * Además permite **crear** un producto/servicio al vuelo (nombre + tipo + precio) sin salir a
 * Products/Services: el contenedor lo guarda contra `/catalog/items` y lo agrega a la línea.
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
export class CatalogItemPickerComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() items: BillingCatalogItem[] = [];
  @Input() searching = false;
  /** El contenedor está guardando un alta rápida (deshabilita el mini-formulario). */
  @Input() creating = false;

  @Output() closed = new EventEmitter<void>();
  @Output() searchChanged = new EventEmitter<string>();
  @Output() itemPicked = new EventEmitter<BillingCatalogItem>();
  @Output() createRequested = new EventEmitter<CatalogQuickCreate>();

  readonly query = signal('');

  // ---------- Alta rápida ----------
  readonly showCreate = signal(false);
  readonly newName = signal('');
  readonly newKind = signal<'Product' | 'Service'>('Service');
  readonly newPrice = signal<number | null>(null);
  readonly newTaxPercent = signal<number | null>(null);
  // Solo Product
  readonly newSku = signal('');
  readonly newCost = signal<number | null>(null);
  readonly newUnit = signal('');
  readonly newTrackInventory = signal(true);

  readonly isProduct = computed(() => this.newKind() === 'Product');

  readonly canCreate = computed(
    () => this.newName().trim().length > 0 && (this.newPrice() ?? 0) > 0 && !this.creating,
  );

  ngOnChanges(changes: SimpleChanges): void {
    // Cada apertura vuelve al modo lista (nunca abrir directo en el formulario de alta).
    if (changes['isOpen'] && this.isOpen) {
      this.showCreate.set(false);
    }
  }

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

  /** Abre el mini-formulario prellenando el nombre con lo que se venía buscando. */
  openCreate(): void {
    this.newName.set(this.query().trim());
    this.newKind.set('Service');
    this.newPrice.set(null);
    this.newTaxPercent.set(null);
    this.newSku.set('');
    this.newCost.set(null);
    this.newUnit.set('');
    this.newTrackInventory.set(true);
    this.showCreate.set(true);
  }

  cancelCreate(): void {
    this.showCreate.set(false);
  }

  submitCreate(): void {
    if (!this.canCreate()) {
      return;
    }
    const product = this.isProduct();
    this.createRequested.emit({
      name: this.newName().trim(),
      kind: this.newKind(),
      price: this.newPrice() ?? 0,
      taxPercent: this.newTaxPercent() ?? 0,
      sku: product ? this.newSku().trim() || null : undefined,
      cost: product ? this.newCost() : undefined,
      unit: product ? this.newUnit().trim() || null : undefined,
      trackInventory: product ? this.newTrackInventory() : undefined,
    });
  }

  close(): void {
    this.closed.emit();
  }
}
