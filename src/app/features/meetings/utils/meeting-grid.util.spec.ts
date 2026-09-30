import { describe, expect, it } from 'vitest';
import { TileCandidate, computeGridLayout, maxTilesFor, selectVisibleTiles } from './meeting-grid.util';

describe('computeGridLayout', () => {
  it('uses a single tile that fills the width-limited box', () => {
    const l = computeGridLayout(1600, 1000, 1, 12);
    expect(l.cols).toBe(1);
    expect(l.tileWidth).toBe(1600);
    expect(l.tileHeight).toBe(900);
  });

  it('puts 2 side by side on a wide stage and stacked on a tall (phone) stage', () => {
    expect(computeGridLayout(1600, 600, 2, 12).cols).toBe(2);
    expect(computeGridLayout(380, 700, 2, 12).cols).toBe(1);
  });

  it('never exceeds the container', () => {
    for (const n of [3, 5, 7, 9, 12]) {
      const l = computeGridLayout(1024, 600, n, 12);
      expect(l.cols * l.tileWidth + (l.cols - 1) * 12).toBeLessThanOrEqual(1024);
      expect(l.rows * l.tileHeight + (l.rows - 1) * 12).toBeLessThanOrEqual(600);
    }
  });

  it('handles an unmeasured container', () => {
    expect(computeGridLayout(0, 0, 3).tileWidth).toBe(0);
  });
});

describe('maxTilesFor', () => {
  it('fits more tiles on a large stage than on a phone', () => {
    const desktop = maxTilesFor(1600, 900, 200);
    const phone = maxTilesFor(360, 560, 132);
    expect(desktop).toBeGreaterThan(phone);
    expect(phone).toBeGreaterThanOrEqual(1);
    expect(maxTilesFor(10_000, 10_000, 10, 12, 16 / 9, 16)).toBe(16); // tope duro
  });
});

describe('selectVisibleTiles', () => {
  const c = (id: string, o: Partial<TileCandidate> = {}): TileCandidate => ({
    id,
    isLocal: false,
    pinned: false,
    handRaised: false,
    speaking: false,
    joinOrder: Number(id.replace(/\D/g, '')) || 0,
    ...o,
  });

  it('keeps a stable order (pinned, me, join order) when everything fits', () => {
    const r = selectVisibleTiles([c('p3'), c('me', { isLocal: true, joinOrder: 9 }), c('p1', { speaking: true }), c('p2', { pinned: true })], 6);
    expect(r).toEqual({ visible: ['p2', 'me', 'p1', 'p3'], overflow: 0 });
  });

  it('reserves the last slot for +N and prioritizes raised hands and speakers', () => {
    const list = [
      c('me', { isLocal: true }),
      c('p1'),
      c('p2'),
      c('p3', { speaking: true }),
      c('p4', { handRaised: true }),
      c('p5'),
    ];
    const r = selectVisibleTiles(list, 4);
    expect(r.visible).toEqual(['me', 'p4', 'p3']);
    expect(r.overflow).toBe(3);
  });

  it('always shows at least one tile', () => {
    const r = selectVisibleTiles([c('a'), c('b')], 0);
    expect(r.visible).toHaveLength(1);
    expect(r.overflow).toBe(1);
  });
});
