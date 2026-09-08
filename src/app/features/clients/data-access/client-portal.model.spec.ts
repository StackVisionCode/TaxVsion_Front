import { describe, expect, it } from 'vitest';
import {
  InvitationResponse,
  PortalUserResponse,
  derivePortalAccess,
  portalStatusLabel,
} from './client-portal.model';

function invite(overrides: Partial<InvitationResponse> = {}): InvitationResponse {
  return {
    id: 'inv1',
    email: 'client@test.com',
    actorType: 'CustomerPortal',
    status: 'Pending',
    createdAtUtc: '2026-02-01T00:00:00Z',
    expiresAtUtc: '2026-02-08T00:00:00Z',
    resendCount: 0,
    lastSentAtUtc: null,
    invitedByUserId: null,
    customerId: 'c1',
    ...overrides,
  };
}

function user(overrides: Partial<PortalUserResponse> = {}): PortalUserResponse {
  return {
    id: 'u1',
    name: 'Client',
    lastName: 'Portal',
    email: 'client@test.com',
    actorType: 'CustomerPortal',
    isActive: true,
    mfaEnabled: false,
    createdAtUtc: '2026-02-10T00:00:00Z',
    roles: ['SystemCustomerPortal'],
    customerId: 'c1',
    ...overrides,
  };
}

describe('derivePortalAccess', () => {
  it('is not-invited with no invitations and no users', () => {
    const access = derivePortalAccess([], [], 'fallback@test.com');
    expect(access.status).toBe('not-invited');
    expect(access.email).toBe('fallback@test.com');
  });

  it('is pending with a pending invitation and no user', () => {
    const access = derivePortalAccess([invite({ resendCount: 2 })], [], 'x');
    expect(access.status).toBe('pending');
    expect(access.pendingInvitationId).toBe('inv1');
    expect(access.resendsLeft).toBe(3);
  });

  it('is active when a portal user exists and is active', () => {
    const access = derivePortalAccess([invite()], [user({ isActive: true })], 'x');
    expect(access.status).toBe('active');
    expect(access.portalUserId).toBe('u1');
  });

  it('is deactivated when the portal user is inactive', () => {
    const access = derivePortalAccess([], [user({ isActive: false })], 'x');
    expect(access.status).toBe('deactivated');
    expect(access.portalUserId).toBe('u1');
  });

  it('a user takes precedence over a lingering pending invitation', () => {
    const access = derivePortalAccess([invite({ status: 'Pending' })], [user({ isActive: true })], 'x');
    expect(access.status).toBe('active');
  });

  it('is expired when only a closed invitation remains and no user', () => {
    const access = derivePortalAccess([invite({ status: 'Cancelled' })], [], 'x');
    expect(access.status).toBe('expired');
  });

  it('prefers the portal user email, then the invitation email, then the fallback', () => {
    expect(derivePortalAccess([], [user({ email: 'u@t.com' })], 'fb').email).toBe('u@t.com');
    expect(derivePortalAccess([invite({ email: 'i@t.com' })], [], 'fb').email).toBe('i@t.com');
    expect(derivePortalAccess([], [], 'fb').email).toBe('fb');
  });
});

describe('portalStatusLabel', () => {
  it('gives a human label per status', () => {
    expect(portalStatusLabel('active')).toBe('Portal active');
    expect(portalStatusLabel('not-invited')).toBe('No portal access');
  });
});
