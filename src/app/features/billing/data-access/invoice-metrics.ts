import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import { InvoiceSummary } from './billing.model';

/** Totales monetarios de UNA moneda. Nunca se suman importes de monedas distintas. */
export interface CurrencyTotals {
  currency: string;
  outstandingCents: number;
  collectedCents: number;
}

/** Agregados del listado, todos derivables de `InvoiceSummary` sin inventar nada. */
export interface InvoiceMetrics {
  /** Moneda principal: la de la oficina (perfil del emisor). */
  currency: string;
  /** Totales en la moneda principal (0 si no hay facturas en ella). */
  outstandingCents: number;
  collectedCents: number;
  /**
   * Facturas en OTRAS monedas (histórico o clientes extranjeros): se informan aparte, una fila por
   * moneda, en vez de sumarlas al total principal como si fueran la misma unidad.
   */
  otherCurrencies: CurrencyTotals[];
  draftCount: number;
  /** Media de días entre creación y cobro sobre las pagadas; null si todavía no hay ninguna. */
  averageDaysToPay: number | null;
}

/**
 * Resume un conjunto de facturas (item 6.1/6.5). Agrupa los importes POR MONEDA: la principal es la
 * moneda de la oficina y el resto se devuelve en `otherCurrencies`, ordenado por código. Un borrador
 * todavía no debe nada y una anulada tampoco, así que no cuentan como pendiente.
 */
export function summarizeInvoices(invoices: readonly InvoiceSummary[], primaryCurrency: string): InvoiceMetrics {
  const primary = (primaryCurrency || '').toUpperCase();
  const byCurrency = new Map<string, CurrencyTotals>();
  const bucket = (currency: string): CurrencyTotals => {
    const code = (currency || primary).toUpperCase();
    let totals = byCurrency.get(code);
    if (!totals) {
      totals = { currency: code, outstandingCents: 0, collectedCents: 0 };
      byCurrency.set(code, totals);
    }
    return totals;
  };

  let totalDays = 0;
  let paidCount = 0;
  let draftCount = 0;

  for (const invoice of invoices) {
    const totals = bucket(invoice.currency);
    if (invoice.status !== 'Draft' && invoice.status !== 'Voided') {
      totals.outstandingCents += invoice.amountDueCents;
    }
    totals.collectedCents += invoice.amountPaidCents;
    if (invoice.status === 'Draft') {
      draftCount++;
    }
    const paidAt = parseUtcDateOrNull(invoice.paidAtUtc);
    const createdAt = parseUtcDateOrNull(invoice.createdAtUtc);
    if (paidAt && createdAt) {
      totalDays += (paidAt.getTime() - createdAt.getTime()) / 86_400_000;
      paidCount++;
    }
  }

  const main = byCurrency.get(primary) ?? { currency: primary, outstandingCents: 0, collectedCents: 0 };
  const otherCurrencies = [...byCurrency.values()]
    .filter(totals => totals.currency !== primary)
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    currency: primary,
    outstandingCents: main.outstandingCents,
    collectedCents: main.collectedCents,
    otherCurrencies,
    draftCount,
    averageDaysToPay: paidCount === 0 ? null : Math.round((totalDays / paidCount) * 10) / 10,
  };
}
