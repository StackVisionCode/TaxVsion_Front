import { parseUtcDate } from '@shared/utils/utc-date.util';
import { MeetingEndReason, MeetingYouRemovedReason } from './meeting.model';

/**
 * Reloj del meeting (F3, T-41). El corte real lo decide el servidor (`endsAtUtc`): el cliente solo
 * cuenta hacia atrás contra el reloj del SERVIDOR, estimado con el `emittedAtUtc` de los sobres del
 * socket frente a `Date.now()` del navegador. Funciones puras compartidas por la sala, el mini-player
 * y el portal (misma tabla allá; test de igualdad en cada repo).
 */

/** Milisegundos por segundo, para que los orquestadores no lleven literales de tiempo. */
export const MS_PER_SECOND = 1000;

/** "0:12" — cronómetro de la grabación en curso (ms transcurridos). */
export function formatRecordingElapsed(elapsedMs: number): string {
  const s = Math.floor(elapsedMs / MS_PER_SECOND);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Desfase servidor−cliente en ms (negativo si el navegador va adelantado). null si la marca no se puede leer. */
export function estimateServerOffsetMs(emittedAtUtc: string | null | undefined, receivedAtMs: number): number | null {
  if (!emittedAtUtc) {
    return null;
  }
  const emitted = parseUtcDate(emittedAtUtc).getTime();
  return Number.isNaN(emitted) ? null : emitted - receivedAtMs;
}

/** Segundos que faltan para `endsAtUtc` según el reloj del servidor (nunca negativo). null sin tope. */
export function remainingSecondsAt(endsAtUtc: string | null, nowMs: number, offsetMs: number): number | null {
  if (!endsAtUtc) {
    return null;
  }
  const ends = parseUtcDate(endsAtUtc).getTime();
  if (Number.isNaN(ends)) {
    return null;
  }
  return Math.max(0, Math.round((ends - (nowMs + offsetMs)) / 1000));
}

/** "mm:ss", o "h:mm:ss" a partir de una hora. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

/** Texto del aviso de tiempo: 600 s → "10 minutes", 60 s → "1 minute". */
export function durationWarningLabel(remainingSeconds: number): string {
  const minutes = Math.max(1, Math.round(remainingSeconds / 60));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** Título de la pantalla de fin según el motivo del servidor. */
export function meetingEndedMessage(reason: MeetingEndReason | 'Expired' | null | undefined): string {
  switch (reason) {
    case 'MaxDurationReached':
      return 'Meeting ended: time limit reached';
    case 'NoParticipants':
      return 'Meeting ended: everyone left';
    case 'Host':
      return 'The host ended the meeting';
    default:
      return 'Meeting ended';
  }
}

/** Toast al ser sacado de la sala por el servidor (`meeting.you.removed`). */
export function youRemovedMessage(reason: MeetingYouRemovedReason): string {
  switch (reason) {
    case 'RemovedByHost':
      return 'You were removed by the host';
    case 'Grace':
      return 'Connection lost: you left the meeting';
    case 'MeetingEnded':
      return 'The meeting has ended';
    case 'Revoked':
      return 'Your invitation was revoked';
    default:
      return 'Your session ended';
  }
}

/** Etiqueta corta del motivo de fin para la lista ("Time limit"); null cuando no aporta nada. */
export function endReasonShortLabel(reason: MeetingEndReason | null | undefined): string | null {
  switch (reason) {
    case 'MaxDurationReached':
      return 'Time limit';
    case 'NoParticipants':
      return 'Everyone left';
    default:
      return null;
  }
}

/** Copy de los códigos de ack de las acciones de host (lock / mute_all / transfer / roles). */
export function hostActionErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'Meeting.HostOnly':
      return 'Only the host can do that.';
    case 'Meeting.TargetNotJoined':
      return 'That participant is no longer in the meeting.';
    case 'Meeting.Role.NotEligible':
      return 'Clients and guests cannot be made host or co-host.';
    case 'Auth.Forbidden':
      return "You don't have permission to do that.";
    case 'Socket.NotConnected':
      return 'Not connected to the meeting server.';
    default:
      return 'That action could not be completed.';
  }
}
