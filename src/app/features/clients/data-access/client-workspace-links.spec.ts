import { composeEmailLink, newSignatureRequestLink, scheduleMeetingLink } from './client-workspace-links';

describe('client-workspace-links', () => {
  it('firma: /signature?new=1&customerId&customerName', () => {
    expect(newSignatureRequestLink('cus-1', 'Ana López')).toEqual({
      commands: ['/signature'],
      queryParams: { new: '1', customerId: 'cus-1', customerName: 'Ana López' },
    });
  });

  it('reunión: /meetings?schedule=1&customerId&customerName', () => {
    expect(scheduleMeetingLink('cus-1', 'Ana López')).toEqual({
      commands: ['/meetings'],
      queryParams: { schedule: '1', customerId: 'cus-1', customerName: 'Ana López' },
    });
  });

  it('correo: /email?compose=1&to&customerId, sin `to` si no hay email', () => {
    expect(composeEmailLink('cus-1', ' ana@example.com ')).toEqual({
      commands: ['/email'],
      queryParams: { compose: '1', customerId: 'cus-1', to: 'ana@example.com' },
    });
    expect(composeEmailLink('cus-1', '').queryParams['to']).toBeUndefined();
  });
});
