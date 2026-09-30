import { reissueBlockReason } from './billing.model';

describe('reissueBlockReason (item 6.3)', () => {
  it('bloquea una factura ya reemplazada', () => {
    expect(
      reissueBlockReason({ status: 'Voided', isReissuable: false, replacedByInvoiceId: 'abc' }),
    ).toContain('already replaced');
  });

  it('bloquea borradores y anuladas', () => {
    expect(reissueBlockReason({ status: 'Draft', isReissuable: false, replacedByInvoiceId: null })).not.toBeNull();
    expect(reissueBlockReason({ status: 'Voided', isReissuable: false, replacedByInvoiceId: null })).not.toBeNull();
  });

  it('respeta isReissuable=false del backend', () => {
    expect(reissueBlockReason({ status: 'Paid', isReissuable: false, replacedByInvoiceId: null })).not.toBeNull();
  });

  it('permite una emitida no reemplazada, y no bloquea si el backend no manda isReissuable', () => {
    expect(reissueBlockReason({ status: 'Issued', isReissuable: true, replacedByInvoiceId: null })).toBeNull();
    expect(
      reissueBlockReason({ status: 'Paid', replacedByInvoiceId: null } as never),
    ).toBeNull();
  });
});
