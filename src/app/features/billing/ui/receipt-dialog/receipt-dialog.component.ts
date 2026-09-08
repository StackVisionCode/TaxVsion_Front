import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import { InvoicePaymentMethod, InvoiceSummary, formatCents } from '../../data-access/billing.model';

/**
 * Comprobante de pago. Todo lo que muestra viene del propio `InvoiceSummaryResponse`: cuando la
 * factura queda pagada, Billing mina `ReceiptNumber` (`REC-{invoiceNumber}`) y `ReceiptHash`, un
 * SHA-256 del canónico `tenant|invoice|número|importe|moneda|método|fecha`. Es **reproducible**:
 * cualquiera con los mismos datos obtiene el mismo hash, así que sirve para comprobar que el
 * recibo no fue alterado. No hay endpoint de recibos ni envío por email: solo esto y el PDF.
 */
@Component({
  selector: 'app-receipt-dialog',
  imports: [CommonModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './receipt-dialog.component.html',
})
export class ReceiptDialogComponent {
  @Input() invoice: InvoiceSummary | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() hashCopyRequested = new EventEmitter<string>();
  @Output() pdfRequested = new EventEmitter<InvoiceSummary>();

  get isOpen(): boolean {
    return !!this.invoice;
  }

  money(cents: number): string {
    return formatCents(cents, this.invoice?.currency ?? 'USD');
  }

  longDate(value: string | null | undefined): string {
    const date = parseUtcDateOrNull(value);
    return date
      ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '—';
  }

  methodLabel(method: InvoicePaymentMethod | null | undefined): string {
    if (!method) {
      return '—';
    }
    return method === 'BankTransfer' ? 'Bank transfer' : method;
  }

  /** El hash completo es ilegible en pantalla: se muestra el prefijo y se copia entero. */
  shortHash(hash: string | null | undefined): string {
    return hash ? `${hash.slice(0, 32)}…` : '—';
  }

  copyHash(): void {
    if (this.invoice?.receiptHash) {
      this.hashCopyRequested.emit(this.invoice.receiptHash);
    }
  }

  openPdf(): void {
    if (this.invoice) {
      this.pdfRequested.emit(this.invoice);
    }
  }

  close(): void {
    this.closed.emit();
  }
}
