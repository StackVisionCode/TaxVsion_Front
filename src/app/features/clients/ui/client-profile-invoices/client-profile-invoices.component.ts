import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

type InvoiceStatus = 'draft' | 'pending' | 'paid' | 'overdue';

interface ClientInvoice {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  amount: number;
  status: InvoiceStatus;
}

const MOCK_INVOICES: ClientInvoice[] = [
  { id: 'inv-1', invoiceNumber: 'INV-2026-0141', issueDate: 'Jun 30, 2026', amount: 1850, status: 'paid' },
  { id: 'inv-2', invoiceNumber: 'INV-2026-0128', issueDate: 'May 18, 2026', amount: 640, status: 'paid' },
  { id: 'inv-3', invoiceNumber: 'INV-2026-0119', issueDate: 'Apr 22, 2026', amount: 975, status: 'pending' },
  { id: 'inv-4', invoiceNumber: 'INV-2026-0104', issueDate: 'Mar 9, 2026', amount: 420, status: 'overdue' },
  { id: 'inv-5', invoiceNumber: 'INV-2026-0091', issueDate: 'Feb 14, 2026', amount: 1200, status: 'paid' },
  { id: 'inv-6', invoiceNumber: 'INV-2026-0077', issueDate: 'Jan 6, 2026', amount: 300, status: 'draft' },
];

/**
 * Pestaña "Invoices" del perfil de cliente (estilo "Aether"): fila de tarjetas
 * pastel con totales (facturado / pendiente) sobre una tabla compacta de
 * facturas del cliente con chip de estado outline. Solo hover en las filas,
 * sin navegación real hacia el módulo de Invoices. Datos mock estáticos,
 * independientes del `clientId` recibido.
 */
@Component({
  selector: 'app-client-profile-invoices',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-invoices.component.html',
})
export class ClientProfileInvoicesComponent {
  @Input() clientId = '';

  readonly invoices = signal<ClientInvoice[]>([...MOCK_INVOICES]);

  readonly totalInvoiced = computed(() => this.invoices().reduce((sum, inv) => sum + inv.amount, 0));

  readonly outstandingBalance = computed(() =>
    this.invoices()
      .filter(inv => inv.status === 'pending' || inv.status === 'overdue')
      .reduce((sum, inv) => sum + inv.amount, 0),
  );

  readonly paidCount = computed(() => this.invoices().filter(inv => inv.status === 'paid').length);

  formatCurrency(amount: number): string {
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
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
}
