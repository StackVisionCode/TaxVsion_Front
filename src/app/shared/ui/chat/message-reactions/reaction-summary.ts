import type { MessageReactionSummary } from '../chat-message.model';

/**
 * F8d (T-26): suma o resta una persona en el chip de un emoji. Idempotente (un evento repetido no duplica) y
 * quita el chip que queda en cero. La usan el chat y la sala.
 */
export function applyReaction(
  reactions: readonly MessageReactionSummary[],
  change: { emoji: string; userId: string },
  delta: 1 | -1,
): MessageReactionSummary[] {
  const existing = reactions.find(r => r.emoji === change.emoji);
  if (delta === 1) {
    if (existing?.userIds.includes(change.userId)) {
      return [...reactions];
    }
    return existing
      ? reactions.map(r => (r === existing ? { ...r, count: r.count + 1, userIds: [...r.userIds, change.userId] } : r))
      : [...reactions, { emoji: change.emoji, count: 1, userIds: [change.userId] }];
  }
  if (!existing?.userIds.includes(change.userId)) {
    return [...reactions];
  }
  return reactions
    .map(r => (r === existing ? { ...r, count: r.count - 1, userIds: r.userIds.filter(id => id !== change.userId) } : r))
    .filter(r => r.count > 0);
}

/** ¿Ya reaccioné con este emoji? (decide agregar o quitar). */
export function hasMyReaction(reactions: readonly MessageReactionSummary[] | undefined, emoji: string, userId: string | null): boolean {
  return !!userId && !!reactions?.some(r => r.emoji === emoji && r.userIds.includes(userId));
}

/** Códigos del servidor al reaccionar → copy en inglés. */
export function reactionErrorText(code: string | undefined): string {
  switch (code) {
    case 'Chat.Reaction.LimitReached':
      return 'You reached the reaction limit for this message.';
    case 'Chat.Reaction.InvalidEmoji':
      return 'That reaction is not available.';
    case 'Chat.RateLimited':
      return 'Too many reactions, slow down.';
    default:
      return "Couldn't update the reaction.";
  }
}
