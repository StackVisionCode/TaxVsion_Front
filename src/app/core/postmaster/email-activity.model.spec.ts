import { describe, expect, it } from 'vitest';
import {
  EMAIL_ACTIVITY_FILTERS,
  EMAIL_ENGAGEMENT_FILTERS,
  ENGAGEMENT_HINT,
  engagementBadges,
  statusHint,
  statusLabel,
} from './email-activity.model';

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

describe('Email activity: aperturas y clics', () => {
  it('los filtros de interacción son Opened y Clicked, con ícono', () => {
    expect(EMAIL_ENGAGEMENT_FILTERS.map(option => [option.id, option.label, option.icon])).toEqual([
      ['Opened', 'Opened', 'eye-outline'],
      ['Clicked', 'Clicked', 'link-outline'],
    ]);
  });

  it('un ícono por cada interacción, con el aviso de que es aproximado', () => {
    expect(engagementBadges({ opened: false, clicked: false })).toEqual([]);
    expect(engagementBadges({ opened: true, clicked: false }).map(badge => badge.kind)).toEqual(['Opened']);

    const both = engagementBadges({ opened: true, clicked: true });
    expect(both.map(badge => badge.kind)).toEqual(['Opened', 'Clicked']);
    expect(both[1].hint).toBe(`Clicked. ${ENGAGEMENT_HINT}`);
  });
});
