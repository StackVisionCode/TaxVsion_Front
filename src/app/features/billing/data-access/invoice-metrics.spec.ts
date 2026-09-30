import { InvoiceSummary } from './billing.model';
import { summarizeInvoices } from './invoice-metrics';

/** Factura mínima para los agregados; el resto de campos no influye. */
function invoice(partial: Partial<InvoiceSummary>): InvoiceSummary {
  return {
    id: partial.id ?? crypto.randomUUID(),
    status: 'Issued',
    currency: 'USD',
    subtotalCents: 0,
    taxTotalCents: 0,
    totalCents: 0,
    amountDueCents: 0,
    amountPaidCents: 0,
    createdAtUtc: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('summarizeInvoices (item 6.1/6.5)', () => {
  it('usa la moneda de la oficina como principal aunque la primera factura sea de otra', () => {
    const metrics = summarizeInvoices(
      [
        invoice({ currency: 'EUR', amountDueCents: 5_000 }),
        invoice({ currency: 'USD', amountDueCents: 1_000, amountPaidCents: 200 }),
      ],
      'USD',
    );

    expect(metrics.currency).toBe('USD');
    expect(metrics.outstandingCents).toBe(1_000);
    expect(metrics.collectedCents).toBe(200);
  });

  it('no suma importes de monedas distintas: las demás se informan aparte y ordenadas', () => {
    const metrics = summarizeInvoices(
      [
        invoice({ currency: 'USD', amountDueCents: 1_000 }),
        invoice({ currency: 'MXN', amountDueCents: 7_000 }),
        invoice({ currency: 'EUR', amountDueCents: 3_000, amountPaidCents: 500 }),
        invoice({ currency: 'EUR', amountDueCents: 2_000 }),
      ],
      'USD',
    );

    expect(metrics.outstandingCents).toBe(1_000);
    expect(metrics.otherCurrencies).toEqual([
      { currency: 'EUR', outstandingCents: 5_000, collectedCents: 500 },
      { currency: 'MXN', outstandingCents: 7_000, collectedCents: 0 },
    ]);
  });

  it('borradores y anuladas no cuentan como pendiente, pero los borradores se cuentan', () => {
    const metrics = summarizeInvoices(
      [
        invoice({ status: 'Draft', amountDueCents: 9_000 }),
        invoice({ status: 'Voided', amountDueCents: 4_000 }),
        invoice({ status: 'PartiallyPaid', amountDueCents: 300, amountPaidCents: 700 }),
      ],
      'USD',
    );

    expect(metrics.outstandingCents).toBe(300);
    expect(metrics.collectedCents).toBe(700);
    expect(metrics.draftCount).toBe(1);
  });

  it('sin facturas en la moneda principal devuelve 0 en ella y no inventa otra', () => {
    const metrics = summarizeInvoices([invoice({ currency: 'EUR', amountDueCents: 100 })], 'usd');

    expect(metrics.currency).toBe('USD');
    expect(metrics.outstandingCents).toBe(0);
    expect(metrics.otherCurrencies.map(o => o.currency)).toEqual(['EUR']);
  });

  it('calcula la media de días a cobro solo sobre las pagadas', () => {
    const metrics = summarizeInvoices(
      [
        invoice({ status: 'Paid', createdAtUtc: '2026-01-01T00:00:00Z', paidAtUtc: '2026-01-03T00:00:00Z' }),
        invoice({ status: 'Paid', createdAtUtc: '2026-01-01T00:00:00Z', paidAtUtc: '2026-01-06T00:00:00Z' }),
        invoice({ status: 'Issued' }),
      ],
      'USD',
    );

    expect(metrics.averageDaysToPay).toBe(3.5);
    expect(summarizeInvoices([], 'USD').averageDaysToPay).toBeNull();
  });
});
