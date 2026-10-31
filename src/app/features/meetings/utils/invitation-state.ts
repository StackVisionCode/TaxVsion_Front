import type { StatusTone } from '@shared/ui/status-pill/status-pill.component';
import type { MeetingInvitationListItem } from '../data-access/meeting.model';

/**
 * F6 — estado derivado de una invitación (panel Invite y panel de agendar):
 *  - revoked: el host la revocó (`revokedAt`).
 *  - closed:  la reunión terminó/se canceló/expiró (`closedAt`).
 *  - expired: pasó `expiresAt` sin cierre explícito.
 *  - used:    guest de un solo uso que ya entró (`usedAt`); sigue revocable (expulsa al guest, INV-09).
 *  - active:  vigente. Para usuarios con cuenta el token es reutilizable: `useCount` solo informa.
 */
export type InvitationState = 'active' | 'used' | 'revoked' | 'expired' | 'closed';

export function invitationState(invitation: MeetingInvitationListItem, nowMs = Date.now()): InvitationState {
  if (invitation.revokedAt) {
    return 'revoked';
  }
  if (invitation.closedAt) {
    return 'closed';
  }
  if (new Date(invitation.expiresAt).getTime() < nowMs) {
    return 'expired';
  }
  if (invitation.usedAt) {
    return 'used';
  }
  return 'active';
}

/** Tono de la píldora por estado. */
export function invitationTone(state: InvitationState): StatusTone {
  switch (state) {
    case 'active':
      return 'success';
    case 'used':
      return 'brand';
    case 'revoked':
      return 'danger';
    default:
      return 'muted';
  }
}

/** Texto de la píldora ("Joined" para el guest que ya entró; el resto, el estado con mayúscula). */
export function invitationStateLabel(state: InvitationState): string {
  return state === 'used' ? 'Joined' : state.charAt(0).toUpperCase() + state.slice(1);
}

/** Revocar tiene sentido mientras el enlace o el guest sigan vivos. */
export function canRevokeInvitation(state: InvitationState): boolean {
  return state === 'active' || state === 'used';
}

const KIND_FALLBACK: Record<MeetingInvitationListItem['inviteeKind'], string> = {
  Employee: 'Team member',
  Customer: 'Client',
  External: 'Guest',
};

/** Nombre visible: nombre > email > tipo ("Team member", "Client", "Guest"); nunca el id. */
export function invitationLabel(invitation: Pick<MeetingInvitationListItem, 'inviteeName' | 'inviteeEmail' | 'inviteeKind'>): string {
  return invitation.inviteeName || invitation.inviteeEmail || KIND_FALLBACK[invitation.inviteeKind] || 'Guest';
}
