import { describe, expect, it } from 'vitest';
import { MeetingParticipantDto } from './meeting.model';
import { applyProfileChangeToRoster, isRoleEligible, mergeMeetingParticipant, mergeMeetingRoster, sortRaisedHands } from './meeting-participants.util';

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
    handRaisedAtUtc: null,
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

describe('sortRaisedHands (D-49)', () => {
  it('ordena por handRaisedAtUtc (primero el que la levantó antes), sin marca al final por joinOrder, y solo Joined', () => {
    const roster = [
      participant('c', { joinOrder: 3, handRaised: true, handRaisedAtUtc: '2026-10-30T12:05:00Z' }),
      participant('a', { joinOrder: 1, handRaised: true, handRaisedAtUtc: '2026-10-30T12:01:00Z' }),
      participant('old', { joinOrder: 2, handRaised: true, handRaisedAtUtc: null }), // backend viejo: sin marca
      participant('down', { joinOrder: 0 }),
      participant('gone', { joinOrder: 4, status: 'Left', handRaised: true, handRaisedAtUtc: '2026-10-30T12:00:00Z' }),
    ];
    expect(sortRaisedHands(roster).map(p => p.userId)).toEqual(['a', 'c', 'old']);
  });

  it('isRoleEligible: staff sí, clientes/invitados no, sin actorType se asume staff', () => {
    expect(isRoleEligible({ actorType: 'TenantEmployee' })).toBe(true);
    expect(isRoleEligible({ actorType: 'TenantAdmin' })).toBe(true);
    expect(isRoleEligible({ actorType: 'CustomerPortal' })).toBe(false);
    expect(isRoleEligible({ actorType: 'Guest' })).toBe(false);
    expect(isRoleEligible({})).toBe(true);
  });
});
