import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InvoiceItem, InvoiceLineItem, InvoiceStatus, invoiceTotal } from '../invoice-table/invoice-table.component';

/**
 * Vista previa de solo lectura de una factura (mismo patrón "takeover" que
 * meeting-room-preview, intercambiado con la lista vía *ngIf/else en la
 * página): encabezado con número/estado/fechas, bloque "Bill to", tabla de
 * líneas y resumen de totales (sin impuestos/descuentos reales, subtotal =
 * total). "Send reminder" es puramente visual: solo dispara un toast local
 * transitorio, sin envío real.
 */
@Component({
  selector: 'app-invoice-preview',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './invoice-preview.component.html',
})
export class InvoicePreviewComponent {
  @Input() invoice: InvoiceItem | null = null;
  @Output() back = new EventEmitter<void>();

  readonly showToast = signal(false);

  lineTotal(item: InvoiceLineItem): number {
    return item.quantity * item.unitPrice;
  }

  total(invoice: InvoiceItem): number {
    return invoiceTotal(invoice);
  }

  formatCurrency(amount: number): string {
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  }

  formatDate(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
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

  goBack(): void {
    this.back.emit();
  }

  sendReminder(): void {
    this.showToast.set(true);
    setTimeout(() => this.showToast.set(false), 2500);
  }
}
