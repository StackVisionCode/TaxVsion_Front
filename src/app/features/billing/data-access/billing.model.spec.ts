import { defaultStatementDescriptor, statementDescriptorError, webhookUrl } from './billing.model';

describe('billing.model (proveedores de cobro)', () => {
  it('defaultStatementDescriptor: quita < > \\ \' " *, junta espacios y recorta a 22', () => {
    expect(defaultStatementDescriptor('Acme "Tax" <Services> & Accounting Group LLC')).toBe('Acme Tax Services & Ac');
    expect(defaultStatementDescriptor("O'Brien\\Tax*Co")).toBe('OBrienTaxCo');
    expect(defaultStatementDescriptor('  Acme   Tax  ')).toBe('Acme Tax');
  });

  it('defaultStatementDescriptor: menos de 5 caracteres o sin nombre → vacío', () => {
    expect(defaultStatementDescriptor('A*B*C')).toBe('');
    expect(defaultStatementDescriptor(null)).toBe('');
    expect(defaultStatementDescriptor(undefined)).toBe('');
  });

  it('statementDescriptorError: mismas reglas que el backend (sobre el valor recortado)', () => {
    expect(statementDescriptorError('   ')).toBe('required');
    expect(statementDescriptorError('Abcd')).toBe('length');
    expect(statementDescriptorError('A'.repeat(23))).toBe('length');
    expect(statementDescriptorError('Acme*Tax')).toBe('characters');
    expect(statementDescriptorError('  Acme Tax  ')).toBeNull();
    expect(statementDescriptorError('A'.repeat(22))).toBeNull();
  });

  it('webhookUrl: base + ruta sin barras dobles; vacía si falta algo; absoluta se respeta', () => {
    expect(webhookUrl('https://acme.taxoffix.io/', '/payments-client/webhooks/t1/stripe')).toBe(
      'https://acme.taxoffix.io/payments-client/webhooks/t1/stripe',
    );
    expect(webhookUrl('http://localhost:5047', 'payments-client/webhooks/t1/stripe')).toBe(
      'http://localhost:5047/payments-client/webhooks/t1/stripe',
    );
    expect(webhookUrl('https://acme.taxoffix.io', null)).toBe('');
    expect(webhookUrl('', '/x')).toBe('');
    expect(webhookUrl('', 'https://hooks.example.com/x')).toBe('https://hooks.example.com/x');
  });
});
