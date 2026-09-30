import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InvoiceMetrics } from '../../data-access/billing.store';
import { formatCents } from '../../data-access/billing.model';

/**
 * Las cuatro tarjetas de cabecera del listado de facturas.
 *
 * El CRM legado tenía una quinta, "Overdue", y otra de "Due within 30 days". Ninguna se puede
 * calcular acá: `InvoiceSummaryResponse` no trae `dueDateUtc` (el agregado sí lo guarda, pero no se
 * proyecta), así que no hay forma de saber si una factura está vencida. Se muestra "Outstanding",
 * que es lo que el contrato sí permite afirmar.
 */
@Component({
  selector: 'app-invoice-metrics',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './invoice-metrics.component.html',
})
export class InvoiceMetricsComponent {
  @Input({ required: true }) metrics!: InvoiceMetrics;
  @Input() loading = false;

  money(cents: number): string {
    return formatCents(cents, this.metrics.currency);
  }

  /** "12.4 days" o un guion cuando todavía no se cobró ninguna factura. */
  get averageLabel(): string {
    const average = this.metrics.averageDaysToPay;
    return average === null ? '—' : `${average} ${average === 1 ? 'day' : 'days'}`;
  }
}
