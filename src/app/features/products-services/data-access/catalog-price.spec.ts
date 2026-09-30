import { formatCatalogPrice } from './catalog.model';

describe('formatCatalogPrice (item 6.1)', () => {
  it('formatea con la moneda propia del ítem', () => {
    expect(formatCatalogPrice(1250, 'USD')).toBe('$1,250.00');
    expect(formatCatalogPrice(90, 'EUR')).toBe('€90.00');
  });

  it('no revienta con un código inválido', () => {
    expect(formatCatalogPrice(10, 'X')).toBe('10 X');
  });
});
