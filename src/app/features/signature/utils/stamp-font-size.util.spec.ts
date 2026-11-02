import { describe, expect, it } from 'vitest';
import {
  INITIALS_TYPEFACE,
  StampTextMeasurer,
  StampTypography,
  TEXT_TYPEFACE,
  fitSingleLine,
  fitWrappedText,
  formatStampDate,
  fontSizeOptions,
  hasFontSize,
  stampPreview,
  startingFontSize,
  toInitials,
} from './stamp-font-size.util';

const RULE: StampTypography = { autoFontMinPt: 6, autoFontMaxPt: 12, autoHeightRatio: 0.75, minFontSizePt: 6 };
// Medidor determinista: 0.5 em por carácter.
const halfEm: StampTextMeasurer = (text, size) => text.length * size * 0.5;

describe('stamp typography (same rule as the sealer)', () => {
  it('auto takes three quarters of the box height, capped by the platform range', () => {
    expect(startingFontSize(null, 12, RULE)).toBe(9);
    expect(startingFontSize(undefined, 40, RULE)).toBe(12);
    expect(startingFontSize(null, 4, RULE)).toBe(6);
  });

  it('a chosen size wins over auto', () => {
    expect(startingFontSize(20, 10, RULE)).toBe(20);
  });

  it('never grows: a size that fits is kept', () => {
    expect(fitSingleLine('JD', 8, { widthPt: 200, heightPt: 60 }, RULE, INITIALS_TYPEFACE, halfEm)).toBe(8);
  });

  it('shrinks a single line until it fits the width and height', () => {
    const size = fitSingleLine('10/04/2026', 30, { widthPt: 40, heightPt: 20 }, RULE, TEXT_TYPEFACE, halfEm);
    expect(size).toBeLessThan(30);
    expect(size * 10 * 0.5).toBeLessThanOrEqual(40);
  });

  it('wrapped text shrinks until the block fits the height', () => {
    const text = Array(8).fill('rental income').join(' ');
    const size = fitWrappedText(text, 14, { widthPt: 120, heightPt: 30 }, RULE, halfEm);
    expect(size).toBeLessThan(14);
  });

  it('does not go below the floor', () => {
    expect(fitSingleLine('A very long value', 12, { widthPt: 5, heightPt: 2 }, RULE, TEXT_TYPEFACE, halfEm)).toBe(6);
  });

  it('only initials, date and text have a font size', () => {
    expect(hasFontSize('initials')).toBe(true);
    expect(hasFontSize('date')).toBe(true);
    expect(hasFontSize('text')).toBe(true);
    expect(hasFontSize('signature')).toBe(false);
  });

  it('initials take the first letter of each word, up to four', () => {
    expect(toInitials('ana maria perez')).toBe('AMP');
    expect(toInitials('A B C D E')).toBe('ABCD');
    expect(toInitials('  ')).toBe('—');
  });

  it('formats the date with the office pattern', () => {
    const date = new Date(2026, 9, 4);
    expect(formatStampDate(date, 'MM/dd/yyyy')).toBe('10/04/2026');
    expect(formatStampDate(date, 'dd/MM/yyyy')).toBe('04/10/2026');
    expect(formatStampDate(date, 'yyyy-MM-dd')).toBe('2026-10-04');
  });

  it('previews initials at screen scale with the sealer size, and nothing for signatures', () => {
    // 1.5 px por pt: caja de 30 pt de alto → auto 12 pt (tope) → 18 px en pantalla.
    const preview = stampPreview({ type: 'initials', width: 90, height: 45, content: 'Ana Perez' }, 1.5, RULE);
    expect(preview?.text).toBe('AP');
    expect(preview?.pt).toBe(12);
    expect(preview?.auto).toBe(true);
    expect(preview?.font).toContain('18px');
    expect(stampPreview({ type: 'signature', width: 90, height: 45, content: '' }, 1.5, RULE)).toBeNull();
  });

  it('offers only the sizes the backend allows', () => {
    expect(fontSizeOptions({ minFontSizePt: 8, maxFontSizePt: 14 })).toEqual([8, 9, 10, 11, 12, 14]);
  });
});
