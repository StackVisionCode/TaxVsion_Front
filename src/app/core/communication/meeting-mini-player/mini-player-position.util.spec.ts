import { describe, expect, it } from 'vitest';
import { avoidReservedCorner, clampMiniPlayerPosition, parseStoredPosition } from './mini-player-position.util';

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

describe('avoidReservedCorner (T-58: overlay de llamada + mini-player)', () => {
  const OVERLAY = { width: 384, height: 340 };

  it('sin hueco reservado devuelve la posición tal cual', () => {
    expect(avoidReservedCorner(null, SIZE, VIEWPORT, null)).toBeNull();
    expect(avoidReservedCorner({ x: 10, y: 10 }, SIZE, VIEWPORT, null)).toEqual({ x: 10, y: 10 });
  });

  it('la esquina por defecto pisa el overlay: se corre a la izquierda del hueco', () => {
    const moved = avoidReservedCorner(null, SIZE, VIEWPORT, OVERLAY)!;
    expect(moved.x + SIZE.width).toBeLessThanOrEqual(VIEWPORT.width - 16 - OVERLAY.width);
    expect(moved.y).toBe(VIEWPORT.height - SIZE.height - 16);
  });

  it('una posición arrastrada lejos del overlay no se toca', () => {
    expect(avoidReservedCorner({ x: 40, y: 40 }, SIZE, VIEWPORT, OVERLAY)).toEqual({ x: 40, y: 40 });
  });
});
