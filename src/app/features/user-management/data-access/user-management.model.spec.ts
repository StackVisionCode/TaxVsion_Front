import { avatarColorFor } from '@shared/utils/avatar.util';
import { UserSummary, userToTeamMember } from './user-management.model';

/**
 * El mapeo de estado es la pieza clave del punto 3.2 en el front: un usuario RETIRADO (Offboarded) debe
 * verse como 'removed' (terminal), NO como 'suspended' — si no, la UI ofrecería Reactivate y el backend
 * lo rechazaría.
 */
describe('userToTeamMember — status mapping', () => {
  const base: Omit<UserSummary, 'isActive' | 'status'> = {
    id: 'u1',
    name: 'Sofia',
    lastName: 'Martinez',
    email: 'sofia@example.com',
    actorType: 'TenantEmployee',
    mfaEnabled: false,
    createdAtUtc: '2026-01-01T00:00:00Z',
    roles: [],
  };

  it('maps Offboarded to removed (terminal)', () => {
    expect(userToTeamMember({ ...base, isActive: false, status: 'Offboarded' }).status).toBe('removed');
  });

  it('maps an active user to active', () => {
    expect(userToTeamMember({ ...base, isActive: true, status: 'Active' }).status).toBe('active');
  });

  it('maps a deactivated (not offboarded) user to suspended', () => {
    expect(userToTeamMember({ ...base, isActive: false, status: 'Deactivated' }).status).toBe('suspended');
  });
});

describe('userToTeamMember — foto y color', () => {
  const user: UserSummary = {
    id: 'u1',
    name: 'Sofia',
    lastName: 'Martinez',
    email: 'sofia@example.com',
    actorType: 'TenantEmployee',
    isActive: true,
    status: 'Active',
    mfaEnabled: false,
    createdAtUtc: '2026-01-01T00:00:00Z',
    roles: [],
  };

  it('lleva el avatarFileId (null si el backend no lo manda)', () => {
    expect(userToTeamMember({ ...user, avatarFileId: 'f-1' }).avatarFileId).toBe('f-1');
    expect(userToTeamMember(user).avatarFileId).toBeNull();
  });

  it('el color de las iniciales sale del userId, no del email', () => {
    expect(userToTeamMember(user).avatarColor).toBe(avatarColorFor('u1'));
  });
});
