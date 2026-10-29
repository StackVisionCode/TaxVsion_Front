import type { UserProfileChangedEvent } from '@core/realtime/realtime.model';
import type { MeetingParticipantDto } from './meeting.model';

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
