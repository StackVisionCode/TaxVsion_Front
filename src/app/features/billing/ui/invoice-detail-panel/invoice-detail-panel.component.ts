import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import {
  InvoicePaymentMethod,
  InvoiceStatus,
  InvoiceSummary,
  formatCents,
  invoiceStatusChip,
  invoiceStatusDot,
  invoiceStatusLabel,
} from '../../data-access/billing.model';

/**
 * Detalle de una factura.
 *
 * Muestra todo lo que `InvoiceSummaryResponse` devuelve — y **eso es todo lo que hay**: el endpoint
 * de detalle no incluye las líneas, ni el cliente, ni el vencimiento, ni las notas, aunque el
 * agregado los guarde. El desglose completo vive en el PDF que genera Documents, así que el panel
 * lo dice y ofrece abrirlo en vez de fingir una tabla de líneas vacía.
 */
@Component({
  selector: 'app-invoice-detail-panel',
  imports: [CommonModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './invoice-detail-panel.component.html',
})
export class InvoiceDetailPanelComponent {
  @Input() invoice: InvoiceSummary | null = null;
  @Input() busy = false;

  @Output() closed = new EventEmitter<void>();
  @Output() issueRequested = new EventEmitter<InvoiceSummary>();
  @Output() pdfRequested = new EventEmitter<InvoiceSummary>();
  @Output() recordPaymentRequested = new EventEmitter<InvoiceSummary>();
  @Output() receiptRequested = new EventEmitter<InvoiceSummary>();
  @Output() copyLinkRequested = new EventEmitter<string>();
  @Output() refreshRequested = new EventEmitter<InvoiceSummary>();

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

  statusLabel(status: InvoiceStatus): string {
    return invoiceStatusLabel(status);
  }

  statusChip(status: InvoiceStatus): string {
    return invoiceStatusChip(status);
  }

  statusDot(status: InvoiceStatus): string {
    return invoiceStatusDot(status);
  }

  methodLabel(method: InvoicePaymentMethod | null | undefined): string {
    if (!method) {
      return '—';
    }
    return method === 'BankTransfer' ? 'Bank transfer' : method;
  }

  get canIssue(): boolean {
    return this.invoice?.status === 'Draft';
  }

  get canRecordPayment(): boolean {
    const invoice = this.invoice;
    return !!invoice && invoice.status !== 'Draft' && invoice.status !== 'Voided' && invoice.amountDueCents > 0;
  }

  /**
   * Emitida pero sin PDF ni link todavía: los genera Documents/PaymentClient por eventos, así que
   * hay una ventana de segundos en la que faltan. Se explica en vez de mostrar botones muertos.
   */
  get artifactsPending(): boolean {
    const invoice = this.invoice;
    return !!invoice && invoice.status !== 'Draft' && (!invoice.pdfFileId || !invoice.checkoutUrl);
  }

  close(): void {
    this.closed.emit();
  }
}
