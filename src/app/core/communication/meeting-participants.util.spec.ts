import { describe, expect, it } from 'vitest';
import { MeetingParticipantDto } from './meeting.model';
import { applyProfileChangeToRoster, mergeMeetingParticipant, mergeMeetingRoster } from './meeting-participants.util';

function participant(userId: string, extra: Partial<MeetingParticipantDto> = {}): MeetingParticipantDto {
  return {
    userId,
    displayName: userId,
    role: 'Attendee',
    status: 'Joined',
    joinOrder: 1,
    audioEnabled: true,
    videoEnabled: false,
    screenSharing: false,
    handRaised: false,
    ...extra,
  };
}

describe('meeting-participants.util', () => {
  it('un cambio de media sin foto conserva la conocida; null la quita', () => {
    const prev = participant('a', { avatarFileId: 'f-a' });
    expect(mergeMeetingParticipant(prev, participant('a', { audioEnabled: false })).avatarFileId).toBe('f-a');
    expect(mergeMeetingParticipant(prev, participant('a', { avatarFileId: null })).avatarFileId).toBeNull();
    expect(mergeMeetingParticipant(undefined, participant('b')).avatarFileId).toBeUndefined();
  });

  it('el snapshot de rejoin sin fotos no borra las del roster', () => {
    const roster = mergeMeetingRoster([participant('a', { avatarFileId: 'f-a' })], [participant('a'), participant('b')]);
    expect(roster.map(p => p.avatarFileId)).toEqual(['f-a', undefined]);
  });

  it('user.profile.changed actualiza por userId', () => {
    const roster = [participant('a', { avatarFileId: 'f-a' }), participant('b')];
    const next = applyProfileChangeToRoster(roster, { userId: 'b', displayName: 'Bea', avatarFileId: 'f-b' });
    expect(next[1]).toMatchObject({ displayName: 'Bea', avatarFileId: 'f-b' });
    expect(next[0]).toBe(roster[0]);
    expect(applyProfileChangeToRoster(roster, { userId: 'zzz', avatarFileId: 'x' })).toBe(roster);
    expect(applyProfileChangeToRoster(roster, { userId: 'a' })[0].avatarFileId).toBe('f-a');
  });
});
