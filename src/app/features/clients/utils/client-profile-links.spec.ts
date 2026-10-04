import { describe, expect, it } from 'vitest';
import { composeEmailLink, scheduleMeetingLink, signatureRequestLink } from './client-profile-links';

const CLIENT = { id: 'cus-1', displayName: 'Ana López', email: 'ana@example.com' };

describe('deep links del perfil de cliente', () => {
  it('signature: /signature?new=1&customerId&customerName', () => {
    expect(signatureRequestLink(CLIENT)).toEqual({
      commands: ['/signature'],
      queryParams: { new: '1', customerId: 'cus-1', customerName: 'Ana López' },
    });
  });

  it('meetings: /meetings?schedule=1&customerId&customerName', () => {
    expect(scheduleMeetingLink(CLIENT)).toEqual({
      commands: ['/meetings'],
      queryParams: { schedule: '1', customerId: 'cus-1', customerName: 'Ana López' },
    });
  });

  it('email: /email?compose=1&customerId&to', () => {
    expect(composeEmailLink(CLIENT)).toEqual({
      commands: ['/email'],
      queryParams: { compose: '1', customerId: 'cus-1', to: 'ana@example.com' },
    });
  });

  it('email sin dirección no manda un `to` vacío', () => {
    expect(composeEmailLink({ ...CLIENT, email: '  ' }).queryParams).toEqual({ compose: '1', customerId: 'cus-1' });
  });
});
