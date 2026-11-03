import { describe, expect, it } from 'vitest';
import { EMAIL_ACTIVITY_FILTERS, statusHint, statusLabel } from './email-activity.model';

describe('Email activity: pestañas y píldoras', () => {
  it('cada pestaña se llama igual que la píldora de sus filas (antes "Pending" filtraba "Sent")', () => {
    for (const filter of EMAIL_ACTIVITY_FILTERS.filter(option => option.id !== 'All' && option.id !== 'Complained')) {
      expect(filter.label).toBe(statusLabel(filter.id));
    }
    expect(EMAIL_ACTIVITY_FILTERS.map(option => option.label)).toEqual([
      'All',
      'Delivered',
      'Sent',
      'Delayed',
      'Bounced',
      'Failed',
      'Blocked',
      'Spam',
    ]);
  });

  it('cada estado explica qué significa', () => {
    for (const status of ['Sending', 'Sent', 'Deferred', 'Delivered', 'Bounced', 'Complained', 'Failed', 'Suppressed']) {
      expect(statusHint(status)).not.toBe('');
    }
    expect(statusLabel('Deferred')).toBe('Delayed');
    expect(statusLabel('Suppressed')).toBe('Blocked');
  });
});
