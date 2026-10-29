import { describe, expect, it } from 'vitest';
import { styleClasses } from './data-collection.utils';

describe('styleClasses', () => {
  it('maps every controlled style token to literal classes', () => {
    expect(
      styleClasses({
        width: 'twoThirds',
        align: 'right',
        textSize: 'h2',
        textColor: 'brand',
        background: 'sage',
        spacingTop: 6,
        spacingBottom: 8,
      }),
    ).toEqual([
      'w-full md:w-2/3',
      'text-right',
      'text-2xl',
      'text-brand-bold',
      'rounded-2xl bg-sage-100',
      'mt-6',
      'mb-8',
    ]);
  });

  it('does not create a class from unknown values', () => {
    expect(styleClasses({ width: 'unknown' as never })).toEqual([]);
  });
});
