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
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import {
  InvoiceStatus,
  InvoiceSummary,
  formatCents,
  invoiceStatusChip,
  invoiceStatusDot,
  invoiceStatusLabel,
} from '../../data-access/billing.model';

/** Acción elegida en el menú de una fila. */
export type InvoiceAction = 'details' | 'issue' | 'copyLink' | 'pdf' | 'recordPayment' | 'receipt';

/**
 * Tabla de facturas (mismo patrón que product-table/client-table: cabecera en píldora
 * `bg-brand-white`, filas con hover y menú "..." por fila).
 *
 * **No hay columna de cliente**: `InvoiceSummaryResponse` no devuelve `customerId` ni el nombre,
 * aunque la factura sí guarda un `CustomerSnapshot`. Es una limitación del contrato de lectura, no
 * un olvido de la UI — la página lo declara bajo la tabla y el dato sí aparece en el PDF.
 */
@Component({
  selector: 'app-invoice-table',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './invoice-table.component.html',
})
export class InvoiceTableComponent {
  @Input() invoices: InvoiceSummary[] = [];
  @Input() busyInvoiceId: string | null = null;
  @Input() emptyText = 'No invoices yet';

  @Output() actionRequested = new EventEmitter<{ action: InvoiceAction; invoice: InvoiceSummary }>();

  readonly openMenuId = signal<string | null>(null);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="invoice-menu"]')) {
      this.openMenuId.set(null);
    }
  }

  trackByInvoiceId(_index: number, invoice: InvoiceSummary): string {
    return invoice.id;
  }

  toggleMenu(invoice: InvoiceSummary, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.update(current => (current === invoice.id ? null : invoice.id));
  }

  emit(action: InvoiceAction, invoice: InvoiceSummary, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.actionRequested.emit({ action, invoice });
  }

  money(cents: number, currency: string): string {
    return formatCents(cents, currency);
  }

  /** Un borrador todavía no tiene número: el backend lo asigna al emitir. */
  numberLabel(invoice: InvoiceSummary): string {
    return invoice.invoiceNumber || 'Not issued';
  }

  shortDate(value: string | null | undefined): string {
    const date = parseUtcDateOrNull(value);
    return date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
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

  canIssue(invoice: InvoiceSummary): boolean {
    return invoice.status === 'Draft';
  }

  /** Cobrar a mano solo tiene sentido mientras quede saldo y la factura esté emitida. */
  canRecordPayment(invoice: InvoiceSummary): boolean {
    return invoice.status !== 'Draft' && invoice.status !== 'Voided' && invoice.amountDueCents > 0;
  }
}
