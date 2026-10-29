import type { FormSignatureStatus } from '../data-access/client-forms.model';
import { signatureStatusLabel, signatureStatusTone } from './signature-status';

describe('signature status mapping (P-18)', () => {
  it('maps every active status to its English label and a tone', () => {
    const expected: Record<Exclude<FormSignatureStatus, 'None'>, string> = {
      Requesting: 'Requesting signature…',
      Sent: 'Awaiting signature',
      Signed: 'Signed by participant',
      Completed: 'Signed',
      Sealed: 'Signed & sealed',
      Declined: 'Signature declined',
      Canceled: 'Signature canceled',
      Expired: 'Signature expired',
      Failed: 'Signature failed',
    };
    for (const [status, label] of Object.entries(expected)) {
      expect(signatureStatusLabel(status as FormSignatureStatus)).toBe(label);
      expect(signatureStatusTone(status as FormSignatureStatus)).toBeTruthy();
    }
  });

  it('hides None and missing status', () => {
    expect(signatureStatusLabel('None')).toBeNull();
    expect(signatureStatusLabel(null)).toBeNull();
    expect(signatureStatusLabel(undefined)).toBeNull();
  });

  it('uses neutral tone when there is nothing to show', () => {
    expect(signatureStatusTone('None')).toBe('neutral');
    expect(signatureStatusTone(undefined)).toBe('neutral');
  });

  it('maps completion states to success and failures to danger', () => {
    expect(signatureStatusTone('Completed')).toBe('success');
    expect(signatureStatusTone('Sealed')).toBe('success');
    expect(signatureStatusTone('Declined')).toBe('danger');
    expect(signatureStatusTone('Failed')).toBe('danger');
  });
});
