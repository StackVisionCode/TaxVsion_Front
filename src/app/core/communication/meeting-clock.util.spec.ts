import { describe, expect, it } from 'vitest';
import {
  durationWarningLabel,
  endReasonShortLabel,
  estimateServerOffsetMs,
  formatClock,
  hostActionErrorMessage,
  meetingEndedMessage,
  remainingSecondsAt,
  youRemovedMessage,
} from './meeting-clock.util';

describe('meeting-clock.util (F3 — reloj contra el servidor)', () => {
  it('estimates the server offset from the envelope emittedAtUtc', () => {
    const received = Date.UTC(2026, 9, 29, 12, 0, 0);
    expect(estimateServerOffsetMs('2026-10-29T12:00:05Z', received)).toBe(5000);
    expect(estimateServerOffsetMs('2026-10-29T11:59:58', received)).toBe(-2000); // sin Z → UTC igual
    expect(estimateServerOffsetMs(null, received)).toBeNull();
    expect(estimateServerOffsetMs('nope', received)).toBeNull();
  });

  it('computes the remaining seconds with the offset applied and never goes negative', () => {
    const now = Date.UTC(2026, 9, 29, 12, 0, 0);
    expect(remainingSecondsAt('2026-10-29T12:10:00Z', now, 0)).toBe(600);
    // El navegador va 30 s atrasado: el servidor ya está 30 s más cerca del corte.
    expect(remainingSecondsAt('2026-10-29T12:10:00Z', now, 30_000)).toBe(570);
    expect(remainingSecondsAt('2026-10-29T11:00:00Z', now, 0)).toBe(0);
    expect(remainingSecondsAt(null, now, 0)).toBeNull();
  });

  it('formats mm:ss and h:mm:ss past one hour', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(3599)).toBe('59:59');
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(-5)).toBe('00:00');
  });

  it('labels the warning thresholds and the end reasons', () => {
    expect(durationWarningLabel(600)).toBe('10 minutes');
    expect(durationWarningLabel(300)).toBe('5 minutes');
    expect(durationWarningLabel(60)).toBe('1 minute');
    expect(meetingEndedMessage('MaxDurationReached')).toBe('Meeting ended: time limit reached');
    expect(meetingEndedMessage('NoParticipants')).toBe('Meeting ended: everyone left');
    expect(meetingEndedMessage('Host')).toBe('The host ended the meeting');
    expect(meetingEndedMessage('Backfill')).toBe('Meeting ended');
    expect(meetingEndedMessage(null)).toBe('Meeting ended');
    expect(endReasonShortLabel('MaxDurationReached')).toBe('Time limit');
    expect(endReasonShortLabel('Host')).toBeNull();
  });

  it('maps you.removed reasons and host-action ack codes to copy', () => {
    expect(youRemovedMessage('RemovedByHost')).toBe('You were removed by the host');
    expect(youRemovedMessage('Grace')).toBe('Connection lost: you left the meeting');
    expect(youRemovedMessage('Expired')).toBe('Your session ended');
    expect(youRemovedMessage('Revoked')).toBe('Your invitation was revoked'); // F6: el host revocó al guest
    expect(hostActionErrorMessage('Meeting.Role.NotEligible')).toContain('Clients and guests');
    expect(hostActionErrorMessage('Meeting.HostOnly')).toBe('Only the host can do that.');
    expect(hostActionErrorMessage(undefined)).toBe('That action could not be completed.');
  });
});
