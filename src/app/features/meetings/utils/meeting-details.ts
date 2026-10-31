import type { MeetingEndReason, MeetingEventItem } from '../data-access/meeting.model';

/** "45 s", "12 min", "1h 05m" — duración de la ficha (segundos reales, no minutos redondeados). */
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds <= 0) {
    return '—';
  }
  if (seconds < 60) {
    return `${Math.round(seconds)} s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}m`;
}

const END_REASON_TEXT: Record<MeetingEndReason, string> = {
  Host: 'Ended by the host',
  MaxDurationReached: 'Time limit reached',
  NoParticipants: 'Everyone left',
  Offboarding: 'Host left the office',
  Backfill: 'Closed automatically',
};

export function endReasonText(reason: MeetingEndReason | null | undefined): string | null {
  return reason ? (END_REASON_TEXT[reason] ?? null) : null;
}

export interface MeetingActivityLine {
  seq: number;
  at: string;
  icon: string;
  text: string;
}

const ENTERS = new Set(['participant.joined', 'participant.rejoined']);
const EXITS_BY_TARGET = new Set(['participant.forced_leave', 'participant.removed']);

/**
 * Línea legible de un evento del log para la actividad de la ficha. Los eventos de ruido
 * (voz, calidad, media, reacciones por minuto) no se muestran: devuelve null.
 * `present` (quién está dentro, se arrastra entre páginas) evita una segunda salida de alguien que
 * ya se fue (p. ej. "lost connection" justo después de "left").
 */
export function describeMeetingEvent(
  event: MeetingEventItem,
  nameOf: (userId: string | null) => string,
  present?: Set<string>,
): MeetingActivityLine | null {
  if (present) {
    const entering = ENTERS.has(event.type) ? event.actorUserId : event.type === 'participant.admitted' ? event.targetUserId : null;
    const leaving = event.type === 'participant.left' ? event.actorUserId : EXITS_BY_TARGET.has(event.type) ? event.targetUserId : null;
    if (entering) present.add(entering);
    if (leaving) {
      if (!present.has(leaving)) return null;
      present.delete(leaving);
    }
  }
  const actor = nameOf(event.actorUserId);
  const target = nameOf(event.targetUserId);
  const line = (icon: string, text: string): MeetingActivityLine => ({ seq: event.seq, at: event.at, icon, text });
  switch (event.type) {
    case 'meeting.started':
      return line('play-circle-outline', `${actor} started the meeting`);
    case 'meeting.ended':
      return line('stop-circle-outline', 'Meeting ended');
    case 'participant.joined':
      return line('person-add-outline', `${actor} joined`);
    case 'participant.rejoined':
      return line('refresh-outline', `${actor} rejoined`);
    case 'participant.waiting':
      return line('hourglass-outline', `${actor} asked to join`);
    case 'participant.admitted':
      return line('checkmark-circle-outline', `${actor} let ${target} in`);
    case 'participant.denied':
      return line('close-circle-outline', `${actor} denied ${target}`);
    case 'participant.left':
      return line('log-out-outline', `${actor} left`);
    case 'participant.forced_leave':
      return line('cloud-offline-outline', `${target} lost connection`);
    case 'participant.removed':
      return line('person-remove-outline', `${actor} removed ${target}`);
    case 'screen.started':
      return line('desktop-outline', `${actor} started sharing their screen`);
    case 'screen.stopped':
      return line('desktop-outline', `${actor} stopped sharing their screen`);
    case 'hand.raised':
      return line('hand-left-outline', `${actor} raised their hand`);
    case 'host.transferred':
      return line('swap-horizontal-outline', `${actor} made ${target} the host`);
    case 'host.succeeded':
      return line('swap-horizontal-outline', `${target} became the host`);
    case 'cohost.promoted':
      return line('star-outline', `${actor} made ${target} a co-host`);
    case 'cohost.demoted':
      return line('star-outline', `${actor} removed ${target} as co-host`);
    case 'meeting.locked':
      return line('lock-closed-outline', `${actor} locked the meeting`);
    case 'meeting.unlocked':
      return line('lock-open-outline', `${actor} unlocked the meeting`);
    case 'meeting.muted_all':
      return line('mic-off-outline', `${actor} muted everyone`);
    case 'meeting.duration_warning':
      return line('alarm-outline', 'Time limit warning');
    case 'recording.started':
      return line('radio-button-on-outline', event.actorUserId ? `${actor} started recording` : 'Recording started');
    case 'recording.stopped':
      return line('stop-outline', 'Recording stopped');
    case 'recording.limit_reached':
      return line('alarm-outline', 'Recording reached its time limit');
    default:
      return null;
  }
}
