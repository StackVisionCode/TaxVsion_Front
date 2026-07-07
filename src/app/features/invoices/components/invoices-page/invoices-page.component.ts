import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  InvoiceItem,
  InvoiceStatus,
  InvoiceTableComponent,
  invoiceTotal,
} from '../../ui/invoice-table/invoice-table.component';
import { InvoiceFormPanelComponent } from '../../ui/invoice-form-panel/invoice-form-panel.component';
import { InvoicePreviewComponent } from '../../ui/invoice-preview/invoice-preview.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';

type StatusFilter = 'All' | InvoiceStatus;
const PAGE_SIZE = 8;

/** Builds a YYYY-MM-DD date string relative to today so the mock invoices always look alive. */
function dateInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

let itemSeq = 0;
function item(description: string, quantity: number, unitPrice: number): InvoiceItem['lineItems'][number] {
  itemSeq += 1;
  return { id: `seed-line-${itemSeq}`, description, quantity, unitPrice };
}

const SEED_INVOICES: InvoiceItem[] = [
  {
    id: 'invoice-1',
    invoiceNumber: 'INV-2026-0131',
    client: 'Johnson & Co LLC',
    issueDate: dateInDays(-35),
    dueDate: dateInDays(-20),
    status: 'paid',
    lineItems: [item('Business Tax Return (1120)', 1, 850), item('Tax Planning Session', 1, 250)],
  },
  {
    id: 'invoice-2',
    invoiceNumber: 'INV-2026-0132',
    client: 'Maria Alvarez',
    issueDate: dateInDays(-10),
    dueDate: dateInDays(5),
    status: 'pending',
    lineItems: [item('Individual Tax Return (1040)', 1, 350)],
  },
  {
    id: 'invoice-3',
    invoiceNumber: 'INV-2026-0133',
    client: 'Sunrise Bakery Inc.',
    issueDate: dateInDays(-40),
    dueDate: dateInDays(-10),
    status: 'overdue',
    lineItems: [item('Monthly Bookkeeping', 3, 400), item('Sales Tax Filing', 1, 120)],
  },
  {
    id: 'invoice-4',
    invoiceNumber: 'INV-2026-0134',
    client: 'Robert Kim',
    issueDate: dateInDays(0),
    dueDate: dateInDays(14),
    status: 'draft',
    lineItems: [item('Amended Return (1040-X)', 1, 225)],
  },
  {
    id: 'invoice-5',
    invoiceNumber: 'INV-2026-0135',
    client: 'Delgado Family Trust',
    issueDate: dateInDays(-5),
    dueDate: dateInDays(10),
    status: 'paid',
    lineItems: [item('Tax Planning Session', 2, 250)],
  },
  {
    id: 'invoice-6',
    invoiceNumber: 'INV-2026-0136',
    client: 'Nguyen Enterprises',
    issueDate: dateInDays(-3),
    dueDate: dateInDays(11),
    status: 'pending',
    lineItems: [item('Partnership Return (1065)', 1, 750), item('Quarterly Payroll Filings (941)', 1, 150)],
  },
  {
    id: 'invoice-7',
    invoiceNumber: 'INV-2026-0137',
    client: 'Summit Bakery Inc.',
    issueDate: dateInDays(-60),
    dueDate: dateInDays(-30),
    status: 'overdue',
    lineItems: [item('QuickBooks Cleanup', 1, 600)],
  },
  {
    id: 'invoice-8',
    invoiceNumber: 'INV-2026-0138',
    client: 'Sarah Kim',
    issueDate: dateInDays(-2),
    dueDate: dateInDays(12),
    status: 'paid',
    lineItems: [item('Individual Tax Return (1040)', 1, 350), item('Amended Return (1040-X)', 1, 225)],
  },
  {
    id: 'invoice-9',
    invoiceNumber: 'INV-2026-0139',
    client: 'Marcus Webb',
    issueDate: dateInDays(0),
    dueDate: dateInDays(21),
    status: 'draft',
    lineItems: [item('Payroll Processing (per run)', 4, 95)],
  },
  {
    id: 'invoice-10',
    invoiceNumber: 'INV-2026-0140',
    client: 'Webb Holdings',
    issueDate: dateInDays(-7),
    dueDate: dateInDays(7),
    status: 'pending',
    lineItems: [item('IRS Audit Support', 1, 1200)],
  },
  {
    id: 'invoice-11',
    invoiceNumber: 'INV-2026-0141',
    client: 'Ferreira S-Corp',
    issueDate: dateInDays(-1),
    dueDate: dateInDays(13),
    status: 'paid',
    lineItems: [item('Business Tax Return (1120)', 1, 850), item('Sales Tax Filing', 2, 120)],
  },
  {
    id: 'invoice-12',
    invoiceNumber: 'INV-2026-0142',
    client: 'James Cooper Consulting',
    issueDate: dateInDays(-50),
    dueDate: dateInDays(-20),
    status: 'overdue',
    lineItems: [item('Monthly Bookkeeping', 2, 400), item('Payroll Processing (per run)', 2, 95)],
  },
];

/**
 * Página del módulo Invoices (estilo "Aether"): stats pastel + tabs de
 * estado/búsqueda + tabla de facturas + panel de creación/edición + vista
 * previa de solo lectura (takeover, mismo patrón *ngIf/else que
 * meetings-page). Reemplaza al sistema completo de facturación del CRM
 * original (pasarelas de pago, editor de PDF, gestor de impuestos) por una
 * versión simplificada: todo el estado vive en signals dentro de esta
 * página, sin servicios ni backend, y las líneas son filas libremente
 * tipeadas dentro del propio formulario.
 */
@Component({
  selector: 'app-invoices-page',
  imports: [
    CommonModule,
    FormsModule,
    InvoiceTableComponent,
    InvoiceFormPanelComponent,
    InvoicePreviewComponent,
    PaginationComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './invoices-page.component.html',
})
export class InvoicesPageComponent {
  readonly invoices = signal<InvoiceItem[]>(SEED_INVOICES);

  readonly statusFilters: StatusFilter[] = ['All', 'draft', 'pending', 'paid', 'overdue'];
  readonly activeFilter = signal<StatusFilter>('All');
  readonly search = signal('');

  readonly isPanelOpen = signal(false);
  readonly editingInvoice = signal<InvoiceItem | null>(null);
  readonly previewInvoice = signal<InvoiceItem | null>(null);

  readonly totalInvoicedAmount = computed(() =>
    this.invoices().reduce((sum, invoice) => sum + invoiceTotal(invoice), 0),
  );

  readonly paidThisMonthAmount = computed(() => {
    const now = new Date();
    return this.invoices()
      .filter(invoice => {
        if (invoice.status !== 'paid') {
          return false;
        }
        const issued = new Date(`${invoice.issueDate}T00:00:00`);
        return issued.getMonth() === now.getMonth() && issued.getFullYear() === now.getFullYear();
      })
      .reduce((sum, invoice) => sum + invoiceTotal(invoice), 0);
  });

  readonly pendingAmount = computed(() =>
    this.invoices()
      .filter(invoice => invoice.status === 'pending')
      .reduce((sum, invoice) => sum + invoiceTotal(invoice), 0),
  );

  readonly overdueAmount = computed(() =>
    this.invoices()
      .filter(invoice => invoice.status === 'overdue')
      .reduce((sum, invoice) => sum + invoiceTotal(invoice), 0),
  );

  readonly visibleInvoices = computed<InvoiceItem[]>(() => {
    const query = this.search().trim().toLowerCase();
    const filter = this.activeFilter();
    return this.invoices()
      .filter(invoice => filter === 'All' || invoice.status === filter)
      .filter(
        invoice =>
          !query ||
          invoice.invoiceNumber.toLowerCase().includes(query) ||
          invoice.client.toLowerCase().includes(query),
      );
  });

  readonly currentPage = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly pagedInvoices = computed<InvoiceItem[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleInvoices().slice(start, start + PAGE_SIZE);
  });

  filterLabel(filter: StatusFilter): string {
    return filter === 'All' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1);
  }

  setFilter(filter: StatusFilter): void {
    this.activeFilter.set(filter);
    this.currentPage.set(1);
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    this.currentPage.set(1);
  }

  formatCurrency(amount: number): string {
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
  }

  openCreatePanel(): void {
    this.editingInvoice.set(null);
    this.isPanelOpen.set(true);
  }

  openEditPanel(invoice: InvoiceItem): void {
    this.editingInvoice.set(invoice);
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    this.isPanelOpen.set(false);
    this.editingInvoice.set(null);
  }

  handleSaved(invoice: InvoiceItem): void {
    this.invoices.update(list => {
      const exists = list.some(item => item.id === invoice.id);
      return exists ? list.map(item => (item.id === invoice.id ? invoice : item)) : [...list, invoice];
    });
    this.closePanel();
  }

  markAsPaid(invoice: InvoiceItem): void {
    this.invoices.update(list =>
      list.map(item => (item.id === invoice.id ? { ...item, status: 'paid' as const } : item)),
    );
  }

  deleteInvoice(invoice: InvoiceItem): void {
    this.invoices.update(list => list.filter(item => item.id !== invoice.id));
    if (this.previewInvoice()?.id === invoice.id) {
      this.previewInvoice.set(null);
    }
  }

  openPreview(invoice: InvoiceItem): void {
    this.previewInvoice.set(invoice);
  }

  closePreview(): void {
    this.previewInvoice.set(null);
  }
}
