import { BytesPipe } from './bytes.pipe';
import { MoneyPipe } from './money.pipe';
import { TimeAgoPipe } from './time-ago.pipe';

describe('shared pipes', () => {
  it('bytes', () => {
    const pipe = new BytesPipe();
    expect(pipe.transform(1536)).toBe('2 KB');
    expect(pipe.transform(5 * 1024 ** 3, 'GB')).toBe('5.0 GB');
    expect(pipe.transform(null)).toBe('');
  });

  it('money', () => {
    const pipe = new MoneyPipe();
    expect(pipe.transform(12.5)).toBe('$12.50');
    expect(pipe.transform(1250, 'USD', { fromCents: true })).toBe('$12.50');
    expect(pipe.transform(undefined)).toBe('');
  });

  it('timeAgo', () => {
    const pipe = new TimeAgoPipe();
    const now = Date.parse('2026-09-30T12:00:00Z');
    expect(pipe.transform('2026-09-30T09:00:00Z', now)).toBe('3h ago');
    expect(pipe.transform(null)).toBe('');
  });
});
