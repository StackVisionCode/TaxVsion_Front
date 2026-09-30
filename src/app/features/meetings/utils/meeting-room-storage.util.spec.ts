import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampPosition,
  loadFloatingPosition,
  loadPinnedParticipant,
  saveFloatingPosition,
  savePinnedParticipant,
} from './meeting-room-storage.util';

describe('pinned participant storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('persists per meeting and clears on unpin', () => {
    savePinnedParticipant('m1', 'u1');
    savePinnedParticipant('m2', 'u2');
    expect(loadPinnedParticipant('m1')).toBe('u1');
    expect(loadPinnedParticipant('m2')).toBe('u2');
    savePinnedParticipant('m1', null);
    expect(loadPinnedParticipant('m1')).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => savePinnedParticipant('m1', 'u1')).not.toThrow();
    expect(loadPinnedParticipant('m1')).toBeNull();
    expect(loadFloatingPosition()).toBeNull();
  });
});

describe('floating position storage', () => {
  afterEach(() => sessionStorage.clear());

  it('round-trips and rejects malformed values', () => {
    saveFloatingPosition({ x: 10, y: 20 });
    expect(loadFloatingPosition()).toEqual({ x: 10, y: 20 });
    sessionStorage.setItem('taxvision.meeting.floating-position', '{"x":"a"}');
    expect(loadFloatingPosition()).toBeNull();
    saveFloatingPosition(null);
    expect(loadFloatingPosition()).toBeNull();
  });
});

describe('clampPosition', () => {
  const size = { width: 200, height: 150 };
  const bounds = { width: 1000, height: 600 };

  it('keeps the panel inside the container with a margin', () => {
    expect(clampPosition({ x: -50, y: -10 }, size, bounds, 8)).toEqual({ x: 8, y: 8 });
    expect(clampPosition({ x: 5000, y: 5000 }, size, bounds, 8)).toEqual({ x: 792, y: 442 });
    expect(clampPosition({ x: 300, y: 200 }, size, bounds, 8)).toEqual({ x: 300, y: 200 });
  });

  it('pins to the margin when the panel is larger than the container', () => {
    expect(clampPosition({ x: 100, y: 100 }, { width: 2000, height: 2000 }, bounds, 8)).toEqual({ x: 8, y: 8 });
  });
});
