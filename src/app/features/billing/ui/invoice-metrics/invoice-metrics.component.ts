import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CurrencyTotals, InvoiceMetrics } from '../../data-access/invoice-metrics';
import { formatCents } from '../../data-access/billing.model';

/** Campos monetarios que se muestran por moneda. */
type MoneyField = 'outstandingCents' | 'collectedCents';

/**
 * Las cuatro tarjetas de cabecera del listado de facturas.
 *
 * El CRM legado tenía una quinta, "Overdue", y otra de "Due within 30 days". Ninguna se puede
 * calcular acá: `InvoiceSummaryResponse` no trae `dueDateUtc` (el agregado sí lo guarda, pero no se
 * proyecta), así que no hay forma de saber si una factura está vencida. Se muestra "Outstanding",
 * que es lo que el contrato sí permite afirmar.
 *
 * Las cuatro siguen los filtros del listado (ninguna es global) y `scopeLabel` dice sobre qué
 * conjunto se calcularon (item 6.5). Los importes van en la moneda de la oficina; las facturas en
 * otras monedas se listan debajo, una línea por moneda, sin sumarlas (item 6.1).
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
  /** Descripción del conjunto resumido, p. ej. "12 invoices matching current filters". */
  @Input() scopeLabel = '';
  /** Hay filtros activos: se resalta la línea de alcance. */
  @Input() filtered = false;

  money(cents: number): string {
    return formatCents(cents, this.metrics.currency);
  }

  /** Otras monedas con importe distinto de cero para la tarjeta dada. */
  others(field: MoneyField): CurrencyTotals[] {
    return this.metrics.otherCurrencies.filter(totals => totals[field] !== 0);
  }

  otherMoney(totals: CurrencyTotals, field: MoneyField): string {
    return formatCents(totals[field], totals.currency);
  }

  /** "12.4 days" o un guion cuando todavía no se cobró ninguna factura. */
  get averageLabel(): string {
    const average = this.metrics.averageDaysToPay;
    return average === null ? '—' : `${average} ${average === 1 ? 'day' : 'days'}`;
  }
}
