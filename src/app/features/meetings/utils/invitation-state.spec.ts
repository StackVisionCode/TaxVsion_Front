import { describe, expect, it } from 'vitest';
import type { MeetingInvitationListItem } from '../data-access/meeting.model';
import { canRevokeInvitation, invitationLabel, invitationState, invitationStateLabel, invitationTone } from './invitation-state';

const NOW = Date.parse('2026-10-30T12:00:00Z');

function invitation(overrides: Partial<MeetingInvitationListItem> = {}): MeetingInvitationListItem {
  return {
    id: 'i1',
    inviteeKind: 'External',
    inviteeEmail: 'guest@example.com',
    inviteeUserId: null,
    inviteeName: null,
    expiresAt: '2026-10-30T13:00:00Z',
    usedAt: null,
    revokedAt: null,
    createdAt: '2026-10-30T11:00:00Z',
    ...overrides,
  };
}

describe('invitationState (F6, D-48)', () => {
  it('prioriza revoked > closed > expired > used > active', () => {
    expect(invitationState(invitation({ revokedAt: 'x', closedAt: 'y', usedAt: 'z', expiresAt: '2020-01-01T00:00:00Z' }), NOW)).toBe('revoked');
    expect(invitationState(invitation({ closedAt: 'y', usedAt: 'z', expiresAt: '2020-01-01T00:00:00Z' }), NOW)).toBe('closed');
    expect(invitationState(invitation({ usedAt: 'z', expiresAt: '2020-01-01T00:00:00Z' }), NOW)).toBe('expired');
    expect(invitationState(invitation({ usedAt: '2026-10-30T11:30:00Z' }), NOW)).toBe('used');
    expect(invitationState(invitation(), NOW)).toBe('active');
  });

  it('un usuario con cuenta que ya entró sigue "active": su token es reutilizable (useCount solo informa)', () => {
    expect(invitationState(invitation({ inviteeKind: 'Employee', useCount: 3, firstUsedAt: 'a', lastUsedAt: 'b' }), NOW)).toBe('active');
  });

  it('tonos, etiquetas y revocabilidad por estado', () => {
    expect(invitationTone('active')).toBe('success');
    expect(invitationTone('used')).toBe('brand');
    expect(invitationTone('revoked')).toBe('danger');
    expect(invitationTone('closed')).toBe('muted');
    expect(invitationStateLabel('used')).toBe('Joined');
    expect(invitationStateLabel('closed')).toBe('Closed');
    expect(canRevokeInvitation('active')).toBe(true);
    expect(canRevokeInvitation('used')).toBe(true); // revocar expulsa al guest que está dentro
    expect(canRevokeInvitation('expired')).toBe(false);
  });

  it('etiqueta visible: nombre > email > userId > Guest', () => {
    expect(invitationLabel({ inviteeName: 'Ana', inviteeEmail: 'a@x', inviteeKind: 'Employee' })).toBe('Ana');
    expect(invitationLabel({ inviteeName: null, inviteeEmail: 'a@x', inviteeKind: 'External' })).toBe('a@x');
    expect(invitationLabel({ inviteeName: null, inviteeEmail: null, inviteeKind: 'External' })).toBe('Guest');
    // Sin nombre resuelto nunca se muestra el userId (GUID).
    expect(invitationLabel({ inviteeName: null, inviteeEmail: null, inviteeKind: 'Employee' })).toBe('Team member');
    expect(invitationLabel({ inviteeName: null, inviteeEmail: null, inviteeKind: 'Customer' })).toBe('Client');
  });
});
