import {
  automationLabel,
  averageDelta,
  countDelta,
  durationDelta,
  failureReasonLabel,
  formatDuration,
  formatRate,
  rateDelta,
  trendLabel,
} from './form-insights-format';

describe('form insights format', () => {
  it('formats durations in minutes, hours or days', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(180)).toBe('3 h');
    expect(formatDuration(210)).toBe('3.5 h');
    expect(formatDuration(3 * 1440)).toBe('3 days');
  });

  it('formats rates as whole percentages', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(0.6667)).toBe('67%');
    expect(formatRate(1)).toBe('100%');
  });

  it('compares counts as a percentage, or as an absolute number without a base', () => {
    expect(countDelta(12, 10)).toEqual({
      label: '+20% vs prior period',
      direction: 'up',
      sentiment: 'positive',
    });
    expect(countDelta(5, 10)).toEqual({
      label: '−50% vs prior period',
      direction: 'down',
      sentiment: 'negative',
    });
    expect(countDelta(3, 0)?.label).toBe('+3 vs prior period');
    expect(countDelta(0, 0)).toBeNull();
    expect(countDelta(10, 10)).toEqual({
      label: 'No change vs prior period',
      direction: 'flat',
      sentiment: 'neutral',
    });
  });

  it('compares rates in percentage points', () => {
    expect(rateDelta(0.4, 0.5)).toEqual({
      label: '−10 pts vs prior period',
      direction: 'down',
      sentiment: 'negative',
    });
    expect(rateDelta(0.4, null)).toBeNull();
  });

  it('treats a shorter time and fewer reminders as an improvement', () => {
    expect(durationDelta(180, 240)).toEqual({
      label: '−25% vs prior period',
      direction: 'down',
      sentiment: 'positive',
    });
    expect(averageDelta(1.5, 2)).toEqual({
      label: '−0.5 vs prior period',
      direction: 'down',
      sentiment: 'positive',
    });
    expect(durationDelta(null, 240)).toBeNull();
  });

  it('never shows raw codes', () => {
    expect(failureReasonLabel('Customer.DuplicateFound')).toBe('Possible duplicate client');
    expect(failureReasonLabel('Customer.SomethingOdd')).toBe('Something odd');
    expect(failureReasonLabel('payload_invalid')).toBe('Payload invalid');
    expect(automationLabel('SummaryPdf')).toBe('Summary PDF');
  });

  it('labels days and weeks from the local bucket start', () => {
    expect(trendLabel('2026-10-03', 'Day')).toBe('Oct 3');
    expect(trendLabel('2026-10-03', 'Week')).toBe('Wk of Oct 3');
  });
});
