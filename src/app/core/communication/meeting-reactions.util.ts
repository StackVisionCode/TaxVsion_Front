import { parseUtcDate } from '@shared/utils/utc-date.util';
import type { MeetingReactionReceivedDto } from './meeting.model';

/**
 * F5 (D-50) — reacciones efímeras del meeting, lógica PURA (sin DOM ni timers):
 * - `MeetingReaction`: burbuja viva (quién, qué, hasta cuándo).
 * - `addReaction`: agrega una recibida; si es MI propia reacción y ya la pinté al recibir el ack
 *   (burbuja local), el broadcast no la duplica.
 * - `pruneReactions`: quita las vencidas (`durationSeconds` de la política).
 * - `latestReactionByUser`: la última de cada participante (burbuja sobre su tile).
 * - `reactionErrorMessage`: copy legible de los códigos del ack.
 *
 * Nunca van al historial del chat: viven en memoria mientras dura la animación.
 */
export interface MeetingReaction {
  id: string;
  userId: string;
  displayName: string;
  emoji: string;
  /** Instante local (ms) en que se mostró. */
  shownAtMs: number;
  expiresAtMs: number;
  /** Pintada al recibir el ack de mi propio emit (antes de que llegue el broadcast). */
  local?: boolean;
}

/** Ventana en la que el broadcast de mi reacción se considera el eco de la burbuja local. */
const OWN_ECHO_WINDOW_MS = 2500;

export function addReaction(
  list: readonly MeetingReaction[],
  incoming: { userId: string; displayName: string; emoji: string; local?: boolean },
  nowMs: number,
  durationSeconds: number,
  seq: number,
): MeetingReaction[] {
  if (!incoming.local) {
    const echo = list.find(
      r => r.local && r.userId === incoming.userId && r.emoji === incoming.emoji && nowMs - r.shownAtMs <= OWN_ECHO_WINDOW_MS,
    );
    if (echo) {
      // El broadcast de lo que ya pinté: se marca como confirmada, sin segunda burbuja.
      return list.map(r => (r === echo ? { ...r, local: false } : r));
    }
  }
  const duration = Math.max(1, durationSeconds) * 1000;
  return [
    ...list,
    {
      id: `${incoming.userId}:${seq}`,
      userId: incoming.userId,
      displayName: incoming.displayName,
      emoji: incoming.emoji,
      shownAtMs: nowMs,
      expiresAtMs: nowMs + duration,
      local: incoming.local ?? false,
    },
  ];
}

/** Misma referencia si no venció ninguna (no dispara cambios de más). */
export function pruneReactions(list: readonly MeetingReaction[], nowMs: number): readonly MeetingReaction[] {
  return list.some(r => r.expiresAtMs <= nowMs) ? list.filter(r => r.expiresAtMs > nowMs) : list;
}

export function latestReactionByUser(list: readonly MeetingReaction[]): ReadonlyMap<string, MeetingReaction> {
  const map = new Map<string, MeetingReaction>();
  for (const r of list) {
    map.set(r.userId, r); // la lista está en orden de llegada → gana la última
  }
  return map;
}

/** Instante local de una reacción recibida: su `at` del servidor si se puede leer; si no, ahora. */
export function receivedAtMs(dto: Pick<MeetingReactionReceivedDto, 'at'>, nowMs: number): number {
  const ms = dto.at ? parseUtcDate(dto.at).getTime() : NaN;
  return Number.isNaN(ms) ? nowMs : Math.min(ms, nowMs);
}

/** Copy de los códigos del ack de `meeting.reaction`. */
export function reactionErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'Meeting.ReactionsDisabled':
      return 'Reactions are turned off for this meeting.';
    case 'Meeting.ReactionNotInCatalog':
      return "That reaction isn't available here.";
    case 'Meeting.ReactionRateLimited':
      return "You're reacting too fast. Give it a moment.";
    case 'Meeting.NotParticipant':
      return "You're not in this meeting anymore.";
    case 'Socket.NotConnected':
      return 'Not connected to the meeting server.';
    default:
      return 'Your reaction could not be sent.';
  }
}

/** Copy de los códigos del ack de `meeting.raise_hand`. */
export function handErrorMessage(code: string | undefined, raising: boolean): string {
  switch (code) {
    case 'Meeting.NotParticipant':
      return "You're not in this meeting anymore.";
    case 'Socket.NotConnected':
      return 'Not connected to the meeting server.';
    default:
      return raising ? 'Could not raise your hand.' : 'Could not lower your hand.';
  }
}
