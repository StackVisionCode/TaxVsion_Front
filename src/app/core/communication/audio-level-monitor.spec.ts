import { describe, expect, it } from 'vitest';
import { AudioLevelMonitor, SpeakingDetector, rmsFromTimeDomain } from './audio-level-monitor';

describe('rmsFromTimeDomain', () => {
  it('is 0 for silence (centered at 128) and grows with amplitude', () => {
    expect(rmsFromTimeDomain(new Uint8Array(64).fill(128))).toBe(0);
    expect(rmsFromTimeDomain([])).toBe(0);
    const loud = Array.from({ length: 64 }, (_, i) => (i % 2 ? 192 : 64)); // ±64 → 0.5
    expect(rmsFromTimeDomain(loud)).toBeCloseTo(0.5, 5);
  });
});

describe('SpeakingDetector', () => {
  it('turns on above the threshold and holds before turning off', () => {
    const d = new SpeakingDetector(0.05, 0.02, 400);
    expect(d.update(0.01, 0)).toBe(false);
    expect(d.update(0.08, 100)).toBe(true);
    expect(d.update(0.0, 300)).toBe(true); // dentro del hold
    expect(d.update(0.03, 600)).toBe(true); // bajito pero sobre el umbral de apagado: sigue
    expect(d.update(0.0, 900)).toBe(true);
    expect(d.update(0.0, 1100)).toBe(false); // > 400 ms en silencio
  });
});

describe('AudioLevelMonitor', () => {
  it('degrades silently without Web Audio / streams (jsdom)', () => {
    const m = new AudioLevelMonitor();
    m.sync(new Map([['a', null]]));
    expect(m.speaking().size).toBe(0);
    m.dispose();
    expect(m.speaking().size).toBe(0);
  });
});
