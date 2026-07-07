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
import { InvoiceItem, InvoiceLineItem, InvoiceStatus } from '../invoice-table/invoice-table.component';

const STATUSES: InvoiceStatus[] = ['draft', 'pending', 'paid', 'overdue'];

let lineItemSeq = 0;
/** Genera un id local único para una nueva fila de línea (sin backend). */
function nextLineItemId(): string {
  lineItemSeq += 1;
  return `line-${Date.now()}-${lineItemSeq}`;
}

/**
 * Overlay de creación/edición de facturas (mismo patrón que
 * task-create-panel y meeting-schedule-panel): tarjeta centrada
 * `rounded-[28px]` sobre backdrop con stopPropagation. Un único componente
 * cubre ambos modos: si `invoice` llega con datos precarga el formulario y
 * actúa como edición ("Edit Invoice" / "Save changes"); si es null arranca
 * con una sola línea vacía ("New Invoice" / "Create invoice"). `isEditMode`
 * es una signal propia actualizada en ngOnChanges, no un computed() sobre el
 * @Input (que no reaccionaría a sus cambios). Las líneas son filas
 * libremente tipeadas (sin integración con el catálogo de servicios).
 */
@Component({
  selector: 'app-invoice-form-panel',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './invoice-form-panel.component.html',
})
export class InvoiceFormPanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() invoice: InvoiceItem | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<InvoiceItem>();

  readonly statuses = STATUSES;

  /** Signal propia porque `invoice` es un @Input plano: un computed() no reaccionaría a sus cambios. */
  readonly isEditMode = signal(false);

  readonly client = signal('');
  readonly issueDate = signal('');
  readonly dueDate = signal('');
  readonly status = signal<InvoiceStatus>('draft');
  readonly lineItems = signal<InvoiceLineItem[]>([]);

  readonly isStatusOpen = signal(false);

  readonly canSave = computed(
    () =>
      this.client().trim().length > 0 &&
      !!this.issueDate() &&
      !!this.dueDate() &&
      this.lineItems().some(item => item.description.trim().length > 0),
  );

  readonly grandTotal = computed(() =>
    this.lineItems().reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['invoice'] || changes['isOpen']) {
      this.isEditMode.set(this.invoice !== null);
      this.resetForm();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="invoice-status"]')) {
      this.isStatusOpen.set(false);
    }
  }

  toggleStatusDropdown(): void {
    this.isStatusOpen.update(open => !open);
  }

  selectStatus(status: InvoiceStatus): void {
    this.status.set(status);
    this.isStatusOpen.set(false);
  }

  statusLabel(status: InvoiceStatus): string {
    switch (status) {
      case 'draft':
        return 'Draft';
      case 'pending':
        return 'Pending';
      case 'paid':
        return 'Paid';
      case 'overdue':
        return 'Overdue';
    }
  }

  updateDescription(id: string, value: string): void {
    this.lineItems.update(items => items.map(item => (item.id === id ? { ...item, description: value } : item)));
  }

  updateQuantity(id: string, value: number): void {
    this.lineItems.update(items =>
      items.map(item => (item.id === id ? { ...item, quantity: Math.max(0, Number(value) || 0) } : item)),
    );
  }

  updateUnitPrice(id: string, value: number): void {
    this.lineItems.update(items =>
      items.map(item => (item.id === id ? { ...item, unitPrice: Math.max(0, Number(value) || 0) } : item)),
    );
  }

  lineTotal(item: InvoiceLineItem): number {
    return item.quantity * item.unitPrice;
  }

  addLineItem(): void {
    this.lineItems.update(items => [...items, { id: nextLineItemId(), description: '', quantity: 1, unitPrice: 0 }]);
  }

  removeLineItem(id: string): void {
    this.lineItems.update(items => items.filter(item => item.id !== id));
  }

  formatCurrency(amount: number): string {
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  }

  close(): void {
    this.closed.emit();
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }
    const result: InvoiceItem = {
      id: this.invoice?.id ?? `invoice-${Date.now()}`,
      invoiceNumber: this.invoice?.invoiceNumber ?? this.generateInvoiceNumber(),
      client: this.client().trim(),
      issueDate: this.issueDate(),
      dueDate: this.dueDate(),
      status: this.status(),
      lineItems: this.lineItems()
        .filter(item => item.description.trim().length > 0)
        .map(item => ({ ...item, description: item.description.trim() })),
    };
    this.saved.emit(result);
  }

  private generateInvoiceNumber(): string {
    const year = new Date().getFullYear();
    const random = Math.floor(1000 + Math.random() * 9000);
    return `INV-${year}-${random}`;
  }

  private resetForm(): void {
    const invoice = this.invoice;
    if (invoice) {
      this.client.set(invoice.client);
      this.issueDate.set(invoice.issueDate.slice(0, 10));
      this.dueDate.set(invoice.dueDate.slice(0, 10));
      this.status.set(invoice.status);
      this.lineItems.set(invoice.lineItems.map(item => ({ ...item })));
    } else {
      this.client.set('');
      this.issueDate.set('');
      this.dueDate.set('');
      this.status.set('draft');
      this.lineItems.set([{ id: nextLineItemId(), description: '', quantity: 1, unitPrice: 0 }]);
    }
    this.isStatusOpen.set(false);
  }
}
