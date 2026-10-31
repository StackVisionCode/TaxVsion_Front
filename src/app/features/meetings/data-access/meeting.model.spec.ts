import { describe, expect, it } from 'vitest';
import { buildDurationOptions, toMeetingItem, type MeetingListItemResponse, type MeetingLimits } from './meeting.model';
import { MeetingListComponent } from '../ui/meeting-list/meeting-list.component';

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

describe('toMeetingItem + MeetingListComponent.hasRecording (F7)', () => {
  const response = (overrides: Partial<MeetingListItemResponse> = {}): MeetingListItemResponse => ({
    id: 'm1',
    title: 'Review',
    status: 'Ended',
    shortCode: 'ABC',
    strategy: 'Sfu',
    hostUserId: 'me',
    scheduledForUtc: null,
    startedAtUtc: '2026-10-30T10:00:00Z',
    endedAtUtc: '2026-10-30T10:30:00Z',
    joinedParticipantsCount: 2,
    transcriptFileId: null,
    ...overrides,
  });
  const list = new MeetingListComponent();

  it('lleva recordingState a la fila y ofrece "Recording" solo en reuniones terminadas que se grabaron', () => {
    const recorded = toMeetingItem(response({ recordingState: 'Ready' }), 'me');
    expect(recorded.recordingState).toBe('Ready');
    expect(list.hasRecording(recorded)).toBe(true);
    expect(list.hasRecording(toMeetingItem(response({ recordingState: 'Failed' }), 'me'))).toBe(true);
    expect(list.hasRecording(toMeetingItem(response(), 'me'))).toBe(false);
    expect(list.hasRecording(toMeetingItem(response({ recordingState: 'Idle' }), 'me'))).toBe(false);
    expect(list.hasRecording(toMeetingItem(response({ status: 'Live', recordingState: 'Recording' }), 'me'))).toBe(false);
  });
});
