import { describe, expect, it } from 'vitest';
import {
  MeetingReaction,
  addReaction,
  handErrorMessage,
  latestReactionByUser,
  pruneReactions,
  reactionErrorMessage,
  receivedAtMs,
} from './meeting-reactions.util';

describe('meeting-reactions.util', () => {
  it('agrega burbujas con la duración de la política y las vence', () => {
    let list: readonly MeetingReaction[] = addReaction([], { userId: 'a', displayName: 'Ana', emoji: '👍' }, 1000, 4, 1);
    expect(list[0]).toMatchObject({ id: 'a:1', emoji: '👍', shownAtMs: 1000, expiresAtMs: 5000, local: false });
    expect(pruneReactions(list, 4999)).toBe(list); // misma referencia si nada venció
    expect(pruneReactions(list, 5000)).toEqual([]);
    list = addReaction(list, { userId: 'b', displayName: 'Bo', emoji: '🔥' }, 2000, 4, 2);
    expect(pruneReactions(list, 5500).map(r => r.userId)).toEqual(['b']);
  });

  it('el broadcast de mi propia reacción no duplica la burbuja local (ventana corta); fuera de ella sí es otra', () => {
    const local = addReaction([], { userId: 'me', displayName: 'Me', emoji: '👏', local: true }, 1000, 4, 1);
    const echoed = addReaction(local, { userId: 'me', displayName: 'Me', emoji: '👏' }, 1800, 4, 2);
    expect(echoed).toHaveLength(1);
    expect(echoed[0].local).toBe(false);
    // Ya confirmada: una segunda reacción igual es nueva.
    expect(addReaction(echoed, { userId: 'me', displayName: 'Me', emoji: '👏' }, 2000, 4, 3)).toHaveLength(2);
    // Otro emoji tampoco es eco.
    expect(addReaction(local, { userId: 'me', displayName: 'Me', emoji: '🔥' }, 1200, 4, 4)).toHaveLength(2);
  });

  it('la última reacción de cada participante va sobre su tile', () => {
    let list: readonly MeetingReaction[] = addReaction([], { userId: 'a', displayName: 'Ana', emoji: '👍' }, 0, 4, 1);
    list = addReaction(list, { userId: 'a', displayName: 'Ana', emoji: '🎉' }, 100, 4, 2);
    list = addReaction(list, { userId: 'b', displayName: 'Bo', emoji: '❤️' }, 200, 4, 3);
    const map = latestReactionByUser(list);
    expect(map.get('a')?.emoji).toBe('🎉');
    expect(map.get('b')?.emoji).toBe('❤️');
  });

  it('receivedAtMs usa el `at` del servidor sin adelantarse al reloj local', () => {
    expect(receivedAtMs({ at: '2026-10-30T12:00:00Z' }, Date.parse('2026-10-30T12:00:01Z'))).toBe(Date.parse('2026-10-30T12:00:00Z'));
    expect(receivedAtMs({ at: '2026-10-30T13:00:00Z' }, 5)).toBe(5);
    expect(receivedAtMs({ at: 'garbage' }, 7)).toBe(7);
  });

  it('traduce los códigos de ack a copy legible', () => {
    expect(reactionErrorMessage('Meeting.ReactionsDisabled')).toBe('Reactions are turned off for this meeting.');
    expect(reactionErrorMessage('Meeting.ReactionNotInCatalog')).toBe("That reaction isn't available here.");
    expect(reactionErrorMessage('Meeting.ReactionRateLimited')).toBe("You're reacting too fast. Give it a moment.");
    expect(reactionErrorMessage('Meeting.NotParticipant')).toBe("You're not in this meeting anymore.");
    expect(reactionErrorMessage(undefined)).toBe('Your reaction could not be sent.');
    expect(handErrorMessage('Meeting.NotParticipant', true)).toBe("You're not in this meeting anymore.");
    expect(handErrorMessage('Meeting.BadPayload', true)).toBe('Could not raise your hand.');
    expect(handErrorMessage(undefined, false)).toBe('Could not lower your hand.');
  });
});
