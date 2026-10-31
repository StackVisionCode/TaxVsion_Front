import type { UserProfileChangedEvent } from '@core/realtime/realtime.model';
import type { MeetingParticipantDto } from './meeting.model';
import { parseUtcDate } from '@shared/utils/utc-date.util';

/**
 * Fotos del roster de un meeting. El backend solo resuelve `avatarFileId` en el snapshot y al entrar;
 * los `participant.changed` de media/mano/salida llegan sin él. Campo ausente = conservar la foto
 * conocida; null = sin foto.
 */
export function mergeMeetingParticipant(
  previous: MeetingParticipantDto | undefined,
  next: MeetingParticipantDto,
): MeetingParticipantDto {
  if (next.avatarFileId !== undefined || previous?.avatarFileId === undefined) {
    return next;
  }
  return { ...next, avatarFileId: previous.avatarFileId };
}

/** Roster nuevo (snapshot/rejoin) conservando las fotos que el snapshot no trajo. */
export function mergeMeetingRoster(
  previous: readonly MeetingParticipantDto[],
  next: readonly MeetingParticipantDto[],
): MeetingParticipantDto[] {
  const byId = new Map(previous.map(p => [p.userId, p]));
  return next.map(p => mergeMeetingParticipant(byId.get(p.userId), p));
}

/** `user.profile.changed` sobre el roster (match por userId). Misma referencia si no cambia nada. */
export function applyProfileChangeToRoster(
  roster: MeetingParticipantDto[],
  change: UserProfileChangedEvent | null | undefined,
): MeetingParticipantDto[] {
  if (!change?.userId || !roster.some(p => p.userId === change.userId)) {
    return roster;
  }
  return roster.map(p =>
    p.userId !== change.userId
      ? p
      : {
          ...p,
          ...(change.avatarFileId !== undefined ? { avatarFileId: change.avatarFileId ?? null } : {}),
          ...(change.displayName ? { displayName: change.displayName } : {}),
        },
  );
}

/**
 * F5 (D-49) — cola de manos: los que tienen la mano arriba, del que la levantó primero al último
 * (`handRaisedAtUtc`). Sin marca de tiempo (backend viejo) van al final por orden de entrada.
 */
export function sortRaisedHands(roster: readonly MeetingParticipantDto[]): MeetingParticipantDto[] {
  const at = (p: MeetingParticipantDto): number => {
    const ms = p.handRaisedAtUtc ? parseUtcDate(p.handRaisedAtUtc).getTime() : NaN;
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return roster
    .filter(p => p.status === 'Joined' && (p.handRaised || !!p.handRaisedAtUtc))
    .sort((a, b) => at(a) - at(b) || a.joinOrder - b.joinOrder);
}

/** Solo staff puede ser host/cohost (`Meeting.Role.NotEligible` para clientes e invitados); sin actorType se asume staff. */
export function isRoleEligible(p: Pick<MeetingParticipantDto, 'actorType'>): boolean {
  return !p.actorType || p.actorType === 'TenantEmployee' || p.actorType === 'TenantAdmin';
}
