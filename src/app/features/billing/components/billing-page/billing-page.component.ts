import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { InvoiceMetricsComponent } from '../../ui/invoice-metrics/invoice-metrics.component';
import { InvoiceAction, InvoiceTableComponent } from '../../ui/invoice-table/invoice-table.component';
import { InvoiceFormPanelComponent, InvoiceFormSubmit } from '../../ui/invoice-form-panel/invoice-form-panel.component';
import { InvoiceDetailPanelComponent } from '../../ui/invoice-detail-panel/invoice-detail-panel.component';
import {
  RecordPaymentDialogComponent,
  RecordPaymentRequest,
} from '../../ui/record-payment-dialog/record-payment-dialog.component';
import { ReceiptDialogComponent } from '../../ui/receipt-dialog/receipt-dialog.component';
import {
  CreatePaymentLinkForm,
  PaymentLinksPanelComponent,
} from '../../ui/payment-links-panel/payment-links-panel.component';
import { PaymentMethodFormComponent, StripeCredentials } from '../../ui/payment-method-form/payment-method-form.component';
import { CompanyBrandingFormComponent } from '../../ui/company-branding-form/company-branding-form.component';
import { BillingStore, InvoiceStatusFilter, TAKE_OPTIONS } from '../../data-access/billing.store';
import {
  FILTERABLE_STATUSES,
  InvoiceBranding,
  InvoiceStatus,
  InvoiceSummary,
  IssuerProfile,
  PaymentConfig,
  PaymentLink,
  PaymentLinkStatus,
  invoiceStatusLabel,
  invoicesToCsv,
  paymentLinkUrl,
} from '../../data-access/billing.model';

/** Pestañas de la sección. */
type BillingTab = 'invoices' | 'links' | 'methods' | 'company';

/**
 * Sección de facturación del tenant. Cuatro pestañas sobre backend real: facturas (Billing), links
 * de pago (PaymentClient), proveedor de cobro (PaymentClient) y datos de la empresa
 * (Billing + Documents).
 *
 * El componente solo traduce estado a la UI y despacha intenciones: la lógica vive en
 * {@link BillingStore}, y los diálogos y tablas son componentes tontos de `ui/`.
 */
@Component({
  selector: 'app-billing-page',
  imports: [
    CommonModule,
    FormsModule,
    PaginationComponent,
    InvoiceMetricsComponent,
    InvoiceTableComponent,
    InvoiceFormPanelComponent,
    InvoiceDetailPanelComponent,
    RecordPaymentDialogComponent,
    ReceiptDialogComponent,
    PaymentLinksPanelComponent,
    PaymentMethodFormComponent,
    CompanyBrandingFormComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './billing-page.component.html',
})
export class BillingPageComponent implements OnInit {
  readonly store = inject(BillingStore);

  readonly tab = signal<BillingTab>('invoices');
  readonly takeOptions = TAKE_OPTIONS;
  readonly statusTabs: InvoiceStatusFilter[] = ['All', ...FILTERABLE_STATUSES];

  // Modales
  readonly formOpen = signal(false);
  readonly paymentTarget = signal<InvoiceSummary | null>(null);
  readonly receiptTarget = signal<InvoiceSummary | null>(null);

  ngOnInit(): void {
    this.store.init();
  }

  selectTab(tab: BillingTab): void {
    this.tab.set(tab);
    // Los links son la única pestaña con datos propios que no se cargan en el arranque.
    if (tab === 'links' && this.store.paymentLinks().length === 0) {
      this.store.loadPaymentLinks();
    }
  }

  // ---------- Listado ----------

  statusTabLabel(status: InvoiceStatusFilter): string {
    return status === 'All' ? 'All' : invoiceStatusLabel(status as InvoiceStatus);
  }

  statusTabCount(status: InvoiceStatusFilter): number {
    return this.store.statusCounts()[status] ?? 0;
  }

  /** Texto del vacío: distingue "no hay ninguna" de "los filtros no dejan pasar nada". */
  get emptyText(): string {
    if (this.store.invoices().length === 0) {
      return 'No invoices yet — create the first one';
    }
    return 'No invoices match these filters';
  }

  onTableAction(event: { action: InvoiceAction; invoice: InvoiceSummary }): void {
    const { action, invoice } = event;
    switch (action) {
      case 'details':
        this.store.selectInvoice(invoice);
        break;
      case 'issue':
        this.store.issue(invoice.id);
        break;
      case 'copyLink':
        if (invoice.checkoutUrl) {
          this.store.copyToClipboard(invoice.checkoutUrl, 'Payment link copied.');
        }
        break;
      case 'pdf':
        this.store.openPdf(invoice);
        break;
      case 'recordPayment':
        this.paymentTarget.set(invoice);
        break;
      case 'receipt':
        this.receiptTarget.set(invoice);
        break;
    }
  }

  /**
   * Descarga el listado filtrado como CSV. Se genera en el front porque Billing no tiene endpoint
   * de exportación; sale lo que hay cargado, que es lo que el usuario está viendo.
   */
  exportCsv(): void {
    const rows = this.store.filteredInvoices();
    if (rows.length === 0) {
      return;
    }
    const blob = new Blob([invoicesToCsv(rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Crear ----------

  openForm(): void {
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
  }

  onFormSubmit(submit: InvoiceFormSubmit): void {
    this.store.createInvoice(
      submit.customer,
      submit.customerTaxId,
      submit.currency,
      submit.lines,
      submit.notes,
      submit.alsoIssue,
      () => this.formOpen.set(false),
    );
  }

  // ---------- Detalle ----------

  closeDetail(): void {
    this.store.selectInvoice(null);
  }

  // ---------- Cobro manual ----------

  closePaymentDialog(): void {
    this.paymentTarget.set(null);
  }

  onPaymentConfirmed(request: RecordPaymentRequest): void {
    const invoice = this.paymentTarget();
    if (!invoice) {
      return;
    }
    this.store.recordPayment(invoice.id, request.method, request.amountCents, () => this.paymentTarget.set(null));
  }

  // ---------- Recibo ----------

  closeReceipt(): void {
    this.receiptTarget.set(null);
  }

  copyReceiptHash(hash: string): void {
    this.store.copyToClipboard(hash, 'Verification hash copied.');
  }

  // ---------- Links de pago ----------

  onCreateLink(form: CreatePaymentLinkForm): void {
    this.store.createPaymentLink(form, token =>
      // Se copia sola: un link recién creado casi siempre se va a pegar en un mensaje.
      this.store.copyToClipboard(paymentLinkUrl(token), 'Payment link created and copied.'),
    );
  }

  onRevokeLink(event: { link: PaymentLink; reason: string }): void {
    this.store.revokePaymentLink(event.link, event.reason);
  }

  onLinkStatusFilter(status: PaymentLinkStatus | null): void {
    this.store.setLinkStatusFilter(status);
  }

  copyLinkUrl(url: string): void {
    this.store.copyToClipboard(url, 'Payment link copied.');
  }

  // ---------- Proveedor ----------

  onStripeSave(credentials: StripeCredentials): void {
    this.store.saveStripe(credentials, () => undefined);
  }

  onProviderToggle(config: PaymentConfig): void {
    this.store.toggleProvider(config);
  }

  // ---------- Empresa ----------

  onCompanySave(event: { issuer: IssuerProfile; branding: InvoiceBranding }): void {
    this.store.saveCompany(event.issuer, event.branding);
  }
}
