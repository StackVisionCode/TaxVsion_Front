import { describe, expect, it } from 'vitest';
import type { MeetingEventItem } from '../data-access/meeting.model';
import { describeMeetingEvent, endReasonText, formatSeconds } from './meeting-details';

function event(type: string, actorUserId: string | null = 'u1', targetUserId: string | null = null): MeetingEventItem {
  return { seq: 1, at: '2026-10-30T15:00:00Z', type, actorUserId, targetUserId, payload: null };
}

describe('meeting-details utils', () => {
  it('formatSeconds: segundos, minutos y horas; vacío como raya', () => {
    expect(formatSeconds(45)).toBe('45 s');
    expect(formatSeconds(12 * 60 + 10)).toBe('12 min');
    expect(formatSeconds(65 * 60)).toBe('1h 05m');
    expect(formatSeconds(120 * 60)).toBe('2h');
    expect(formatSeconds(0)).toBe('—');
    expect(formatSeconds(null)).toBe('—');
  });

  it('endReasonText traduce el motivo del fin', () => {
    expect(endReasonText('MaxDurationReached')).toBe('Time limit reached');
    expect(endReasonText('NoParticipants')).toBe('Everyone left');
    expect(endReasonText(null)).toBeNull();
  });

  it('describeMeetingEvent arma la línea con nombres y oculta el ruido (voz, calidad, reacciones)', () => {
    const names = (id: string | null) => (id === 'u1' ? 'Ana' : id === 'u2' ? 'Luis' : 'Someone');
    expect(describeMeetingEvent(event('participant.joined'), names)?.text).toBe('Ana joined');
    expect(describeMeetingEvent(event('participant.removed', 'u1', 'u2'), names)?.text).toBe('Ana removed Luis');
    expect(describeMeetingEvent(event('participant.forced_leave', null, 'u2'), names)?.text).toBe('Luis lost connection');
    expect(describeMeetingEvent(event('screen.started'), names)?.text).toBe('Ana started sharing their screen');
    expect(describeMeetingEvent(event('speaker.started'), names)).toBeNull();
    expect(describeMeetingEvent(event('reaction.summary', null), names)).toBeNull();
    expect(describeMeetingEvent(event('recording.started', null), names)?.text).toBe('Recording started');
  });

  it('con presencia omite una segunda salida de quien ya se fue', () => {
    const names = () => 'Ana';
    const present = new Set<string>();
    const lines = [
      event('participant.joined', 'u1'),
      event('participant.left', 'u1'),
      event('participant.forced_leave', null, 'u1'),
    ].map(e => describeMeetingEvent(e, names, present)?.text ?? null);
    expect(lines).toEqual(['Ana joined', 'Ana left', null]);
  });
});
