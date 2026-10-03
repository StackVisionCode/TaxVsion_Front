import { describe, expect, it } from 'vitest';
import { clampMiniPlayerPosition, parseStoredPosition } from './mini-player-position.util';

const SIZE = { width: 360, height: 300 };
const VIEWPORT = { width: 1280, height: 800 };

describe('clampMiniPlayerPosition', () => {
  it('keeps a position that already fits', () => {
    expect(clampMiniPlayerPosition({ x: 100, y: 120 }, SIZE, VIEWPORT)).toEqual({ x: 100, y: 120 });
  });

  it('pulls the panel back inside the viewport with the margin', () => {
    expect(clampMiniPlayerPosition({ x: 2000, y: -50 }, SIZE, VIEWPORT)).toEqual({ x: 904, y: 16 });
    expect(clampMiniPlayerPosition({ x: -10, y: 9999 }, SIZE, VIEWPORT)).toEqual({ x: 16, y: 484 });
  });

  it('pins to the top-left margin when the panel is bigger than the viewport', () => {
    expect(clampMiniPlayerPosition({ x: 300, y: 300 }, SIZE, { width: 320, height: 200 })).toEqual({ x: 16, y: 16 });
  });

  it('rounds to whole pixels', () => {
    expect(clampMiniPlayerPosition({ x: 100.6, y: 99.2 }, SIZE, VIEWPORT, 8)).toEqual({ x: 101, y: 99 });
  });
});

describe('parseStoredPosition', () => {
  it('reads a stored point', () => {
    expect(parseStoredPosition('{"x":10,"y":20}')).toEqual({ x: 10, y: 20 });
  });

  it('ignores missing or malformed values', () => {
    expect(parseStoredPosition(null)).toBeNull();
    expect(parseStoredPosition('nope')).toBeNull();
    expect(parseStoredPosition('{"x":"1","y":2}')).toBeNull();
    expect(parseStoredPosition('null')).toBeNull();
  });
});
