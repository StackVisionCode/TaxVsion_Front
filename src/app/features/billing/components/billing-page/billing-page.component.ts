import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { FilterChipOption, FilterChipsComponent } from '@shared/ui/filter-chips/filter-chips.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { InvoiceMetricsComponent } from '../../ui/invoice-metrics/invoice-metrics.component';
import { InvoiceAction, InvoiceTableComponent } from '../../ui/invoice-table/invoice-table.component';
import { InvoiceFormPanelComponent, InvoiceFormSubmit } from '../../ui/invoice-form-panel/invoice-form-panel.component';
import { InvoiceDetailPanelComponent } from '../../ui/invoice-detail-panel/invoice-detail-panel.component';
import {
  RecordPaymentDialogComponent,
  RecordPaymentRequest,
} from '../../ui/record-payment-dialog/record-payment-dialog.component';
import { ReceiptDialogComponent } from '../../ui/receipt-dialog/receipt-dialog.component';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import {
  CreatePaymentLinkForm,
  PaymentLinksPanelComponent,
} from '../../ui/payment-links-panel/payment-links-panel.component';
import { BillingStore, InvoiceStatusFilter, TAKE_OPTIONS } from '../../data-access/billing.store';
import {
  FILTERABLE_STATUSES,
  InvoiceStatus,
  InvoiceSummary,
  PaymentLink,
  PaymentLinkStatus,
  invoiceStatusLabel,
  invoicesToCsv,
  paymentLinkUrl,
} from '../../data-access/billing.model';
import { AdminCapabilities } from '@core/access/admin-capabilities';
import { FileViewerComponent } from '@shared/ui/file-viewer/file-viewer.component';
import { FileViewerItem } from '@shared/ui/file-viewer/file-viewer.model';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { CustomerSummary } from '@core/customers/customer-summary.model';

/** Nombre de cliente → fragmento seguro para nombre de archivo ("Acme, Inc." → "acme-inc"). */
function fileSlug(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'client'
  );
}

/** Pestañas de la sección. */
type BillingTab = 'invoices' | 'links';

/**
 * Sección de facturación del tenant: facturas (Billing) y links de pago (PaymentClient). La config
 * de proveedores de cobro y los datos de empresa/branding se movieron a Settings
 * (/billing/providers y /billing/company), reusando el mismo BillingStore.
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
    FilterChipsComponent,
    SearchInputComponent,
    StateBlockComponent,
    InvoiceMetricsComponent,
    InvoiceTableComponent,
    InvoiceFormPanelComponent,
    InvoiceDetailPanelComponent,
    RecordPaymentDialogComponent,
    ReceiptDialogComponent,
    PaymentLinksPanelComponent,
    ConfirmDialogComponent,
    RouterLink,
    FileViewerComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './billing-page.component.html',
})
export class BillingPageComponent implements OnInit {
  /** B6 — los links de pago son `payment_client.payment_link.manage`, no `invoicing.*`. */
  protected readonly can = inject(AdminCapabilities);

  readonly store = inject(BillingStore);
  private readonly directory = inject(CustomerDirectoryStore);

  /** Cliente fijo cuando la página vive en el perfil del cliente (`null` en /billing). */
  readonly embedded = this.store.embeddedCustomer;

  /**
   * Cliente fijo para el formulario de alta. Arranca con lo que da el perfil (id + nombre) y se
   * completa con el directorio (email/teléfono) en `ngOnInit`.
   */
  readonly lockedCustomer = signal<CustomerSummary | null>(null);

  /**
   * Fábrica de alta rápida de catálogo pasada al formulario de factura. Referencia ESTABLE (campo, no
   * método inline) para no romper el change-detection del @Input; delega en el store.
   */
  readonly createCatalogItemFn = this.store.createCatalogItem.bind(this.store);

  readonly tab = signal<BillingTab>('invoices');
  readonly takeOptions = TAKE_OPTIONS;
  readonly statusTabs: InvoiceStatusFilter[] = ['All', ...FILTERABLE_STATUSES];

  readonly tabOptions: FilterChipOption<BillingTab>[] = [
    { id: 'invoices', label: 'Invoices' },
    { id: 'links', label: 'Payment links' },
  ];

  /** Pestañas de estado con su contador (solo cuando hay alguna factura en ese estado). */
  readonly statusTabOptions = computed<FilterChipOption<InvoiceStatusFilter>[]>(() =>
    this.statusTabs.map(status => {
      const count = this.store.statusCounts()[status] ?? 0;
      return { id: status, label: this.statusTabLabel(status), count: count > 0 ? count : null };
    }),
  );

  // Modales
  readonly formOpen = signal(false);
  readonly paymentTarget = signal<InvoiceSummary | null>(null);
  readonly receiptTarget = signal<InvoiceSummary | null>(null);
  /** Confirmaciones in-app (no `confirm()`/`prompt()` nativos: los bloquean algunos navegadores). */
  readonly deleteTarget = signal<InvoiceSummary | null>(null);
  readonly voidTarget = signal<InvoiceSummary | null>(null);
  readonly reissueTarget = signal<InvoiceSummary | null>(null);

  ngOnInit(): void {
    this.store.init();
    this.resolveLockedCustomer();
  }

  /** Embebido: resuelve el `CustomerSummary` del cliente fijo (cacheado en el directorio). */
  private resolveLockedCustomer(): void {
    const embedded = this.embedded();
    if (!embedded) {
      return;
    }
    // Placeholder inmediato: el alta funciona aunque el directorio tarde o falle.
    this.lockedCustomer.set({
      id: embedded.id,
      displayName: embedded.name,
      primaryEmail: '',
      primaryPhone: null,
      kind: 'Individual',
      status: 'Active',
      createdAtUtc: '',
    });
    this.directory.byId([embedded.id]).subscribe({
      next: found => {
        const customer = found.get(embedded.id);
        if (customer) {
          this.lockedCustomer.set(customer);
        }
      },
      error: () => undefined,
    });
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
      case 'edit':
        this.store.beginEdit(invoice.id, () => this.formOpen.set(true));
        break;
      case 'send':
        this.store.sendInvoiceToClient(invoice);
        break;
      case 'delete':
        this.deleteTarget.set(invoice);
        break;
      case 'void':
        this.voidTarget.set(invoice);
        break;
      case 'copyLink':
        if (invoice.checkoutUrl) {
          this.store.copyToClipboard(invoice.checkoutUrl, 'Payment link copied.');
        }
        break;
      case 'pdf':
        this.openPdf(invoice);
        break;
      case 'recordPayment':
        this.paymentTarget.set(invoice);
        break;
      case 'receipt':
        this.receiptTarget.set(invoice);
        break;
      case 'markSent':
        this.store.changeInvoiceStatus(invoice.id, 'Sent', null, () => undefined);
        break;
      case 'markIssued':
        this.store.changeInvoiceStatus(invoice.id, 'Issued', null, () => undefined);
        break;
      case 'reissue':
        this.reissueTarget.set(invoice);
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
    const embedded = this.embedded();
    const prefix = embedded ? `invoices-${fileSlug(embedded.name)}` : 'invoices';
    anchor.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Crear ----------

  openForm(): void {
    // Alta: asegurarse de no arrastrar un detalle de una edición anterior.
    this.store.clearEditing();
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.store.clearEditing();
  }

  onFormSubmit(submit: InvoiceFormSubmit): void {
    const editing = this.store.editingDetail();
    if (editing) {
      this.store.updateInvoice(
        editing.id,
        submit.customer,
        submit.customerTaxId,
        submit.currency,
        submit.lines,
        submit.notes,
        () => this.formOpen.set(false),
      );
      return;
    }
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

  // ---------- Borrar / anular (confirmación in-app) ----------

  confirmDelete(): void {
    const invoice = this.deleteTarget();
    if (invoice) {
      this.store.deleteInvoice(invoice.id);
    }
    this.deleteTarget.set(null);
  }

  confirmVoid(): void {
    const invoice = this.voidTarget();
    if (invoice) {
      this.store.voidInvoice(invoice.id, null);
    }
    this.voidTarget.set(null);
  }

  confirmReissue(): void {
    const invoice = this.reissueTarget();
    if (invoice) {
      // Anula la original y abre el borrador de reemplazo en el editor para corregirlo antes de emitir.
      this.store.reissueInvoice(invoice.id, null, () => this.formOpen.set(true));
    }
    this.reissueTarget.set(null);
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

  @ViewChild(PaymentLinksPanelComponent) private linksPanel?: PaymentLinksPanelComponent;

  onCreateLink(form: CreatePaymentLinkForm): void {
    this.store.createPaymentLink(form, token => {
      // Éxito: cerrar el modal de "New payment link" (antes quedaba abierto) y copiar el link, que
      // casi siempre se pega en un mensaje. Un fallo NO llega acá (lo reporta el store con toast) y
      // deja el modal abierto para reintentar.
      this.linksPanel?.closeForm();
      this.store.copyToClipboard(paymentLinkUrl(token), 'Payment link created and copied.');
    });
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

  // ---------- Visor global (PDF de la factura) ----------

  readonly pdfViewerFiles = signal<FileViewerItem[]>([]);
  readonly pdfViewerOpen = signal(false);

  /** Muestra el PDF de la factura en el visor global (sin abrir otra pestaña). */
  openPdf(invoice: InvoiceSummary): void {
    const item = this.store.pdfViewerItem(invoice);
    if (!item) {
      return;
    }
    this.pdfViewerFiles.set([item]);
    this.pdfViewerOpen.set(true);
  }
}
