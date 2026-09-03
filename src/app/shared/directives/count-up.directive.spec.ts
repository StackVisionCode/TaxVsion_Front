import { describe, expect, it } from 'vitest';
import { formatCount } from './count-up.directive';

describe('formatCount', () => {
  it('renders small integers as-is', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(7)).toBe('7');
  });

  it('groups thousands so a big import reads clearly', () => {
    expect(formatCount(1240)).toBe('1,240');
    expect(formatCount(1000000)).toBe('1,000,000');
  });

  it('rounds fractional in-flight values (the tween passes through decimals)', () => {
    expect(formatCount(1239.6)).toBe('1,240');
    expect(formatCount(3.2)).toBe('3');
  });
});
