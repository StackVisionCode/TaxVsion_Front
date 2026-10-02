import { describe, expect, it } from 'vitest';
import {
  INITIAL_SPEAKER_STATE,
  SpeakerOptions,
  isSpeakingNow,
  pickMiniPlayerTiles,
  stepActiveSpeaker,
} from './active-speaker.util';

const OPTS: SpeakerOptions = { threshold: 0.05, switchMs: 400, holdMs: 600 };

describe('stepActiveSpeaker', () => {
  it('takes the floor immediately when nobody had it', () => {
    const s = stepActiveSpeaker(INITIAL_SPEAKER_STATE, { a: 0.2, b: 0.01 }, 0, OPTS);
    expect(s.current).toBe('a');
  });

  it('ignores levels under the threshold (background noise)', () => {
    const s = stepActiveSpeaker(INITIAL_SPEAKER_STATE, { a: 0.03, b: 0.04 }, 0, OPTS);
    expect(s.current).toBeNull();
  });

  it('keeps the last speaker when everybody goes silent', () => {
    let s = stepActiveSpeaker(INITIAL_SPEAKER_STATE, { a: 0.2 }, 0, OPTS);
    s = stepActiveSpeaker(s, { a: 0 }, 5000, OPTS);
    expect(s.current).toBe('a');
  });

  it('only switches after the candidate stays loudest for switchMs (hysteresis)', () => {
    let s = stepActiveSpeaker(INITIAL_SPEAKER_STATE, { a: 0.2, b: 0 }, 0, OPTS);
    s = stepActiveSpeaker(s, { a: 0.1, b: 0.3 }, 100, OPTS);
    expect(s.current).toBe('a');
    s = stepActiveSpeaker(s, { a: 0.1, b: 0.3 }, 300, OPTS);
    expect(s.current).toBe('a');
    s = stepActiveSpeaker(s, { a: 0.1, b: 0.3 }, 520, OPTS);
    expect(s.current).toBe('b');
  });

  it('resets the candidate timer when the loudest flips back', () => {
    let s = stepActiveSpeaker(INITIAL_SPEAKER_STATE, { a: 0.2, b: 0 }, 0, OPTS);
    s = stepActiveSpeaker(s, { a: 0.1, b: 0.3 }, 100, OPTS);
    s = stepActiveSpeaker(s, { a: 0.4, b: 0.1 }, 200, OPTS); // a recupera
    s = stepActiveSpeaker(s, { a: 0.1, b: 0.3 }, 450, OPTS); // b vuelve a empezar
    expect(s.current).toBe('a');
    s = stepActiveSpeaker(s, { a: 0.1, b: 0.3 }, 860, OPTS);
    expect(s.current).toBe('b');
  });

  it('releases the speaker who left the room', () => {
    let s = stepActiveSpeaker(INITIAL_SPEAKER_STATE, { a: 0.2, b: 0 }, 0, OPTS);
    s = stepActiveSpeaker(s, { b: 0 }, 100, OPTS);
    expect(s.current).toBeNull();
    expect(s.lastVoiceAt['a']).toBeUndefined();
  });

  it('isSpeakingNow holds the indicator for holdMs after the last voice peak', () => {
    const s = stepActiveSpeaker(INITIAL_SPEAKER_STATE, { a: 0.2 }, 1000, OPTS);
    expect(isSpeakingNow(s, 'a', 1500, OPTS)).toBe(true);
    expect(isSpeakingNow(s, 'a', 1700, OPTS)).toBe(false);
    expect(isSpeakingNow(s, 'b', 1000, OPTS)).toBe(false);
  });
});

describe('pickMiniPlayerTiles', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('puts the active speaker in the main tile', () => {
    expect(pickMiniPlayerTiles(ids, 'c', 'b', 4).main).toBe('c');
  });

  it('falls back to the pinned participant, then to the first remote', () => {
    expect(pickMiniPlayerTiles(ids, null, 'b', 4).main).toBe('b');
    expect(pickMiniPlayerTiles(ids, 'gone', 'gone', 4).main).toBe('a');
  });

  it('returns no main tile when I am alone', () => {
    expect(pickMiniPlayerTiles([], null, null, 4)).toEqual({ main: null, thumbs: [], overflow: 0 });
  });

  it('orders thumbnails by most recent voice, then join order, and summarises the rest as +N', () => {
    const tiles = pickMiniPlayerTiles(ids, 'a', null, 4, { e: 200, c: 100 });
    expect(tiles.thumbs).toEqual(['e', 'c', 'b']);
    expect(tiles.overflow).toBe(2);
  });

  it('shows every thumbnail when they all fit (no "+1" for a single extra)', () => {
    const tiles = pickMiniPlayerTiles(['a', 'b', 'c', 'd', 'e'], 'a', null, 4);
    expect(tiles.thumbs).toEqual(['b', 'c', 'd', 'e']);
    expect(tiles.overflow).toBe(0);
  });
});
