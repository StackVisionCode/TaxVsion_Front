import { describe, expect, it } from 'vitest';
import {
  canChangeReviewDueDate,
  dueDateInputValue,
  dueDateToUtc,
  earliestDueDate,
  fieldCommentsFrom,
  formatAnswerValue,
  formatDueDate,
  isOpenReviewStatus,
} from './form-review.format';

describe('form-review format', () => {
  it('treats Completed and Cancelled as terminal and only lets Pending or Returned change the due date', () => {
    expect(['Pending', 'Submitted', 'Returned'].every(isOpenReviewStatus)).toBe(true);
    expect(isOpenReviewStatus('Completed')).toBe(false);
    expect(isOpenReviewStatus('Cancelled')).toBe(false);
    expect(['Pending', 'Returned'].every(canChangeReviewDueDate)).toBe(true);
    expect(['Submitted', 'Completed', 'Cancelled'].some(canChangeReviewDueDate)).toBe(false);
  });

  it('shows the due date as a calendar date, not shifted to the local zone', () => {
    // Medianoche UTC del 15: en EE. UU. toLocaleDateString local daría el 14.
    expect(formatDueDate('2026-11-15T00:00:00Z')).toBe('Nov 15, 2026');
    expect(formatDueDate('2026-11-15T00:00:00')).toBe('Nov 15, 2026');
    expect(formatDueDate('2026-11-15T00:00:00Z', { month: 'short', day: 'numeric' })).toBe(
      'Nov 15',
    );
    expect(formatDueDate(null)).toBe('');
  });

  it('round-trips the date input through midnight UTC', () => {
    expect(dueDateToUtc('2026-11-15')).toBe('2026-11-15T00:00:00Z');
    expect(dueDateToUtc('')).toBeNull();
    expect(dueDateInputValue('2026-11-15T00:00:00')).toBe('2026-11-15');
    expect(earliestDueDate(new Date('2026-11-14T23:30:00Z'))).toBe('2026-11-15');
  });

  it('masks tax identifiers with last4 only', () => {
    const value = {
      sensitiveRef: 'f28627e6-8e3d-4ee5-a63d-a09abb066d2a',
      last4: '1234',
      kind: 'ein',
    };
    expect(formatAnswerValue({ id: 'tax', type: 'taxId' }, value)).toBe('••-•••1234');
    // Aunque el componente ya no exista en la definición, sigue enmascarado.
    expect(formatAnswerValue(null, { ...value, kind: 'ssn' })).toBe('•••-••-1234');
    expect(formatAnswerValue(null, { sensitiveRef: value.sensitiveRef })).toBe('Hidden');
  });

  it('formats options, files and repeated comments', () => {
    const select = {
      id: 'status',
      type: 'select',
      props: { options: [{ value: 'mfj', label: 'Married filing jointly' }] },
    };
    expect(formatAnswerValue(select, 'mfj')).toBe('Married filing jointly');
    expect(formatAnswerValue({ id: 'docs', type: 'file' }, [{ fileId: 'x' }])).toBe('File');
    expect(formatAnswerValue({ id: 'docs', type: 'file' }, [])).toBe('No files');
    expect(fieldCommentsFrom({ 'a:': ' Fix ', 'b:row-1': 'Check', 'c:': '  ' })).toEqual([
      { componentId: 'a', rowId: null, comment: 'Fix' },
      { componentId: 'b', rowId: 'row-1', comment: 'Check' },
    ]);
  });
});
