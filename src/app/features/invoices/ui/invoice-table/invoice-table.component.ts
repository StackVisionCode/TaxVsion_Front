import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export type InvoiceStatus = 'draft' | 'pending' | 'paid' | 'overdue';

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface InvoiceItem {
  id: string;
  invoiceNumber: string;
  client: string;
  /** ISO date string (YYYY-MM-DD). */
  issueDate: string;
  /** ISO date string (YYYY-MM-DD). */
  dueDate: string;
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
}

/** Deriva el total de una factura sumando cantidad * precio unitario de cada línea; nunca se guarda de forma redundante. */
export function invoiceTotal(invoice: InvoiceItem): number {
  return invoice.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

/**
 * Tabla de facturas (patrón "Aether", igual que service-catalog): header en
 * píldora `bg-[#FAF9F7]` con extremos redondeados, columnas Invoice # /
 * Client / Issue date / Due date / Amount / Status (chip outline) y un menú
 * fantasma "..." por fila con Edit/Mark as paid/Delete. El click en la fila
 * (fuera del menú) abre la vista previa de solo lectura.
 */
@Component({
  selector: 'app-invoice-table',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './invoice-table.component.html',
})
export class InvoiceTableComponent {
  @Input() invoices: InvoiceItem[] = [];
  @Output() previewRequested = new EventEmitter<InvoiceItem>();
  @Output() editRequested = new EventEmitter<InvoiceItem>();
  @Output() markPaidRequested = new EventEmitter<InvoiceItem>();
  @Output() deleteRequested = new EventEmitter<InvoiceItem>();

  readonly openMenuId = signal<string | null>(null);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="invoice-menu"]')) {
      this.openMenuId.set(null);
    }
  }

  trackByInvoiceId(_index: number, invoice: InvoiceItem): string {
    return invoice.id;
  }

  total(invoice: InvoiceItem): number {
    return invoiceTotal(invoice);
  }

  formatCurrency(amount: number): string {
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  }

  formatDate(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

  statusChip(status: InvoiceStatus): string {
    switch (status) {
      case 'paid':
        return 'border-emerald-200 text-emerald-600';
      case 'pending':
        return 'border-orange-200 text-orange-500';
      case 'overdue':
        return 'border-red-200 text-red-500';
      case 'draft':
        return 'border-gray-300 text-gray-500';
    }
  }

  statusDot(status: InvoiceStatus): string {
    switch (status) {
      case 'paid':
        return 'bg-emerald-500';
      case 'pending':
        return 'bg-orange-500';
      case 'overdue':
        return 'bg-red-500';
      case 'draft':
        return 'bg-gray-400';
    }
  }

  toggleMenu(invoice: InvoiceItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(this.openMenuId() === invoice.id ? null : invoice.id);
  }

  onRowClick(invoice: InvoiceItem): void {
    this.previewRequested.emit(invoice);
  }

  onEditClick(invoice: InvoiceItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.editRequested.emit(invoice);
  }

  onMarkPaidClick(invoice: InvoiceItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.markPaidRequested.emit(invoice);
  }

  onDeleteClick(invoice: InvoiceItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.deleteRequested.emit(invoice);
  }
}
