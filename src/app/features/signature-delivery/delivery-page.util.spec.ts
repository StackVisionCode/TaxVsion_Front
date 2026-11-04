import { describe, expect, it } from 'vitest';
import { deliveryItemLabel, deliveryPageState, reissueErrorMessage } from './delivery-page.util';
import { PublicDeliveryView } from './signature-delivery.service';

const view = (overrides: Partial<PublicDeliveryView> = {}): PublicDeliveryView => ({
  status: 'Active',
  purpose: 'Completed',
  maskedEmail: 'a***a@example.com',
  expiresAtUtc: '2026-12-01T00:00:00Z',
  items: [],
  canRequestNewLink: true,
  ...overrides,
});

describe('delivery-page.util', () => {
  it('traduce el estado del enlace al de la página', () => {
    expect(deliveryPageState(view())).toBe('ready');
    expect(deliveryPageState(view({ status: 'Expired' }))).toBe('expired');
    expect(deliveryPageState(view({ status: 'Revoked' }))).toBe('revoked');
    expect(deliveryPageState(null)).toBe('invalid');
  });

  it('nombra cada tipo de archivo', () => {
    expect(deliveryItemLabel({ id: '1', title: 'W-2', kind: 'Certificate' })).toBe('Certificate of completion');
    expect(deliveryItemLabel({ id: '1', title: 'W-2', kind: 'SignedDocument' })).toBe('Signed document');
  });

  it('explica el enfriamiento de la reemisión y cae a un mensaje seguro', () => {
    expect(reissueErrorMessage('Signature.Delivery.ReissueTooSoon')).toContain('few minutes ago');
    expect(reissueErrorMessage(undefined)).toContain('contact the office');
  });
});
