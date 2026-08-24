import { Injectable, computed, inject, signal } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { BillingLiveService } from '../../billing-live/data-access/billing-live.service';
import { InvoiceSummary } from '../../billing-live/data-access/billing-live.model';

/** Meses que pinta el gráfico de ingresos del dashboard. */
const MONTHS_IN_CHART = 6;

/** Un mes del gráfico: importe ya cobrado en ese mes, en centavos. */
export interface MonthlyRevenueBucket {
  /** Etiqueta corta del mes ("Jan"), en inglés como el resto de la UI. */
  label: string;
  /** Primer día del mes, por si hace falta ordenar o comparar. */
  monthStart: Date;
  /** Suma de `amountPaidCents` de las facturas pagadas dentro del mes. */
  paidCents: number;
}

/**
 * Formatea centavos como moneda. Billing trabaja SIEMPRE en centavos
 * (`totalCents`, `amountDueCents`, `amountPaidCents`), nunca en unidades.
 */
export function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Estado compartido de facturas para el dashboard.
 *
 * Billing NO tiene endpoint de resumen/analytics (no existe
 * `/billing/invoices/summary` en el backend), y `billing-live` tampoco tiene
 * store: la página de facturación guarda las facturas en signals locales del
 * componente. Como el hero y el gráfico de ingresos necesitan los mismos
 * datos, este store hace UNA sola llamada a `GET /billing/invoices` y expone
 * las agregaciones ya calculadas client-side.
 *
 * Todo lo que se expone se puede derivar de verdad del contrato de
 * `InvoiceSummary`. En particular NO hay "Overdue": `InvoiceSummary` no trae
 * fecha de vencimiento y el enum del backend es
 * Draft/Issued/Sent/PartiallyPaid/Paid/Voided — no existe un estado vencido,
 * así que el widget habla de "Outstanding" (lo que queda por cobrar), que sí
 * es real.
 */
@Injectable({ providedIn: 'root' })
export class DashboardInvoicesStore {
  private readonly service = inject(BillingLiveService);

  private readonly _invoices = signal<InvoiceSummary[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private loaded = false;

  readonly invoices = this._invoices.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Moneda del tenant: la de la primera factura emitida (Billing no expone una moneda de cuenta). */
  readonly currency = computed(() => this._invoices()[0]?.currency ?? 'USD');

  /** Facturas que cuentan como cobrables: ni borrador ni anuladas. */
  private readonly billable = computed(() =>
    this._invoices().filter(inv => {
      const status = (inv.status ?? '').toLowerCase();
      return status !== 'draft' && status !== 'voided';
    }),
  );

  /** Facturas emitidas con saldo pendiente (`amountDueCents > 0`). */
  readonly openInvoices = computed(() => this.billable().filter(inv => inv.amountDueCents > 0));

  /** Total pendiente de cobro, en centavos. */
  readonly outstandingCents = computed(() =>
    this.openInvoices().reduce((sum, inv) => sum + inv.amountDueCents, 0),
  );

  /** Borradores sin emitir todavía. */
  readonly draftCount = computed(
    () => this._invoices().filter(inv => (inv.status ?? '').toLowerCase() === 'draft').length,
  );

  /** Todo lo cobrado históricamente, en centavos. */
  readonly collectedAllTimeCents = computed(() =>
    this._invoices().reduce((sum, inv) => sum + inv.amountPaidCents, 0),
  );

  /**
   * Ingresos cobrados por mes en los últimos {@link MONTHS_IN_CHART} meses.
   * Se agrupa por `paidAtUtc` (cuándo se terminó de cobrar), no por
   * `createdAtUtc`: es la única fecha que representa dinero que entró.
   */
  readonly monthlyRevenue = computed<MonthlyRevenueBucket[]>(() => {
    const now = new Date();
    const buckets: MonthlyRevenueBucket[] = [];
    for (let offset = MONTHS_IN_CHART - 1; offset >= 0; offset--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      buckets.push({
        label: monthStart.toLocaleString('en-US', { month: 'short' }),
        monthStart,
        paidCents: 0,
      });
    }

    const firstMonth = buckets[0].monthStart.getTime();
    for (const invoice of this._invoices()) {
      if (!invoice.paidAtUtc) {
        continue;
      }
      const paidAt = new Date(invoice.paidAtUtc);
      if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() < firstMonth) {
        continue;
      }
      const index = buckets.findIndex(
        b =>
          b.monthStart.getFullYear() === paidAt.getFullYear() &&
          b.monthStart.getMonth() === paidAt.getMonth(),
      );
      if (index !== -1) {
        buckets[index].paidCents += invoice.amountPaidCents;
      }
    }
    return buckets;
  });

  /** Suma de los meses del gráfico. */
  readonly chartTotalCents = computed(() =>
    this.monthlyRevenue().reduce((sum, bucket) => sum + bucket.paidCents, 0),
  );

  /** Cobrado en el mes en curso. */
  readonly collectedThisMonthCents = computed(
    () => this.monthlyRevenue()[MONTHS_IN_CHART - 1]?.paidCents ?? 0,
  );

  /**
   * Variación del mes en curso contra el anterior, en %. `null` cuando el mes
   * anterior fue 0: dividir por cero no da un porcentaje, y estampar "+100%"
   * sería inventarse la tendencia.
   */
  readonly monthOverMonthPercent = computed<number | null>(() => {
    const months = this.monthlyRevenue();
    const previous = months[MONTHS_IN_CHART - 2]?.paidCents ?? 0;
    const current = months[MONTHS_IN_CHART - 1]?.paidCents ?? 0;
    if (previous <= 0) {
      return null;
    }
    return Math.round(((current - previous) / previous) * 1000) / 10;
  });

  /** true cuando ya se sabe que el tenant no tiene ninguna factura todavía. */
  readonly isEmpty = computed(() => !this._loading() && !this._error() && this._invoices().length === 0);

  /**
   * GET /billing/invoices (array completo, el endpoint no pagina). Idempotente:
   * varios widgets pueden llamarlo en el mismo render sin duplicar la petición.
   */
  load(force = false): void {
    if (this._loading() || (this.loaded && !force)) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    this.service.listInvoices().subscribe({
      next: invoices => {
        this._invoices.set(invoices ?? []);
        this.loaded = true;
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }
}
