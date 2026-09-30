import { describe, expect, it } from 'vitest';
import { MEETING_REACTIONS, isMeetingReaction } from './meeting-reactions';

describe('meeting reactions', () => {
  it('offers the expanded reaction set', () => {
    expect(MEETING_REACTIONS.map(r => r.emoji)).toEqual(['👍', '👏', '❤️', '😂', '😮', '🎉', '🙌', '🤔', '👋', '🔥']);
  });

  it('detects a reaction body (trimmed, with or without the U+FE0F selector)', () => {
    expect(isMeetingReaction('👍')).toBe(true);
    expect(isMeetingReaction(' 🔥 ')).toBe(true);
    expect(isMeetingReaction('❤')).toBe(true);
    expect(isMeetingReaction('👍 nice')).toBe(false);
    expect(isMeetingReaction('')).toBe(false);
    expect(isMeetingReaction(null)).toBe(false);
  });
});
