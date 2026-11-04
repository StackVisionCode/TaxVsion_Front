import { describe, expect, it } from 'vitest';
import { SignedDocumentDelivery } from '../data-access/signature.model';
import { canResendDelivery, canRevokeDelivery, deliveryStatusLabel } from './delivery-summary.util';

const delivery = (overrides: Partial<SignedDocumentDelivery> = {}): SignedDocumentDelivery => ({
  id: 'd1',
  signerId: 's1',
  recipientEmail: 'ana@example.com',
  purpose: 'Completed',
  status: 'Active',
  createdAtUtc: '2026-11-01T00:00:00Z',
  lastIssuedAtUtc: '2026-11-01T00:00:00Z',
  expiresAtUtc: '2026-12-01T00:00:00Z',
  issueCount: 1,
  accessCount: 0,
  lastAccessedAtUtc: null,
  revokedAtUtc: null,
  items: [],
  ...overrides,
});

describe('delivery-summary.util', () => {
  it('cuenta las aperturas del enlace vigente', () => {
    expect(deliveryStatusLabel(delivery())).toBe('Not opened yet');
    expect(deliveryStatusLabel(delivery({ accessCount: 1 }))).toBe('Opened 1 time');
    expect(deliveryStatusLabel(delivery({ accessCount: 3 }))).toBe('Opened 3 times');
  });

  it('revocada no se reenvía ni se vuelve a revocar; vencida se puede reenviar', () => {
    expect(canResendDelivery(delivery({ status: 'Revoked' }))).toBe(false);
    expect(canRevokeDelivery(delivery({ status: 'Revoked' }))).toBe(false);
    expect(canResendDelivery(delivery({ status: 'Expired' }))).toBe(true);
    expect(canRevokeDelivery(delivery({ status: 'Expired' }))).toBe(false);
  });
});
