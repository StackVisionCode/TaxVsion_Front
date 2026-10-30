import { describe, expect, it } from 'vitest';
import { buildDurationOptions, type MeetingLimits } from './meeting.model';

const limits = (maxDurationMinutes: number, defaultDurationMinutes: number): MeetingLimits => ({
  maxDurationMinutes,
  defaultDurationMinutes,
  maxParticipants: 10,
  guestsAllowed: true,
});

describe('buildDurationOptions (F3)', () => {
  it('keeps the usual steps that fit in the office maximum', () => {
    expect(buildDurationOptions(limits(60, 60))).toEqual([15, 30, 45, 60]);
    expect(buildDurationOptions(limits(120, 30))).toEqual([15, 30, 45, 60, 90, 120]);
  });

  it('adds the office maximum and default when they are not a usual step', () => {
    expect(buildDurationOptions(limits(50, 20))).toEqual([15, 20, 30, 45, 50]);
  });

  it('offers only the maximum when it is below every step (technical minimum 5)', () => {
    expect(buildDurationOptions(limits(5, 5))).toEqual([5]);
  });

  it('clamps a default above the maximum', () => {
    expect(buildDurationOptions(limits(30, 60))).toEqual([15, 30]);
  });
});
