import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '@shared/ui/modal/modal.component';
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
export type InvoiceAction =
  | 'details'
  | 'issue'
  | 'edit'
  | 'send'
  | 'delete'
  | 'void'
  | 'copyLink'
  | 'pdf'
  | 'recordPayment'
  | 'receipt'
  | 'markSent'
  | 'markIssued'
  | 'reissue';

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
  imports: [CommonModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './invoice-table.component.html',
})
export class InvoiceTableComponent {
  @Input() invoices: InvoiceSummary[] = [];
  @Input() busyInvoiceId: string | null = null;
  @Input() emptyText = 'No invoices yet';

  @Output() actionRequested = new EventEmitter<{ action: InvoiceAction; invoice: InvoiceSummary }>();

  /** Factura cuyo menú de acciones está abierto (modal centrado, no un dropdown lateral que se corta). */
  readonly menuInvoice = signal<InvoiceSummary | null>(null);

  trackByInvoiceId(_index: number, invoice: InvoiceSummary): string {
    return invoice.id;
  }

  openMenu(invoice: InvoiceSummary): void {
    this.menuInvoice.set(invoice);
  }

  closeMenu(): void {
    this.menuInvoice.set(null);
  }

  emit(action: InvoiceAction, invoice: InvoiceSummary): void {
    this.menuInvoice.set(null);
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

  /** Libertad total: se edita cualquier factura salvo una anulada. */
  canEdit(invoice: InvoiceSummary): boolean {
    return invoice.status !== 'Voided';
  }

  /** Enviar al cliente por correo: la factura debe estar emitida (con PDF) y no anulada. */
  canSend(invoice: InvoiceSummary): boolean {
    return invoice.status !== 'Draft' && invoice.status !== 'Voided' && !!invoice.pdfFileId;
  }

  /** Borrable (soft): solo borradores. Una emitida se anula, no se borra. */
  canDelete(invoice: InvoiceSummary): boolean {
    return invoice.status === 'Draft';
  }

  /** Anulable: emitida/enviada/parcial/pagada (repone el stock descontado al emitir). */
  canVoid(invoice: InvoiceSummary): boolean {
    return invoice.status !== 'Draft' && invoice.status !== 'Voided';
  }

  /** Cambio de estado manual (item 6.2): marcar una emitida como "enviada al cliente". */
  canMarkSent(invoice: InvoiceSummary): boolean {
    return invoice.status === 'Issued';
  }

  /** Cambio de estado manual (item 6.2): revertir "enviada" a "emitida" (no se envió al final). */
  canMarkIssued(invoice: InvoiceSummary): boolean {
    return invoice.status === 'Sent';
  }

  /**
   * Reemisión (item 6.3): anular + reemplazo enlazado. Aplica a una factura ya emitida (no borrador) y no
   * anulada. Si ya fue reemplazada, el backend lo rechaza (aquí no se ve ese dato en el summary).
   */
  canReissue(invoice: InvoiceSummary): boolean {
    return invoice.status !== 'Draft' && invoice.status !== 'Voided';
  }
}
