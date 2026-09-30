import { describe, expect, it } from 'vitest';
import { BandwidthGovernor, connectionLabel, scoreConnection, summarizeStats } from './connection-quality.util';

describe('summarizeStats', () => {
  it('computes inbound loss %, jitter and bitrate from deltas between two samples', () => {
    const first = summarizeStats(
      [{ type: 'inbound-rtp', packetsLost: 0, packetsReceived: 1000, bytesReceived: 100_000, jitter: 0.01, timestamp: 1000 }],
      'inbound',
      null,
    );
    expect(first.metrics.lossPct).toBeNull(); // sin muestra previa no hay delta
    expect(first.metrics.jitterMs).toBe(10);

    const second = summarizeStats(
      [
        { type: 'inbound-rtp', packetsLost: 5, packetsReceived: 1095, bytesReceived: 350_000, jitter: 0.02, timestamp: 3000 },
        { type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.12, timestamp: 3000 },
      ],
      'inbound',
      first.counters,
    );
    expect(second.metrics.lossPct).toBe(5); // 5 perdidos de 100
    expect(second.metrics.rttMs).toBe(120);
    expect(second.metrics.bitrateKbps).toBe(1000); // 250 KB en 2 s
  });

  it('uses remote-inbound-rtp fractionLost and RTT for the outbound direction', () => {
    const { metrics } = summarizeStats(
      [
        { type: 'outbound-rtp', packetsSent: 500, bytesSent: 50_000, timestamp: 1 },
        { type: 'remote-inbound-rtp', fractionLost: 0.1, roundTripTime: 0.4, jitter: 0.005, timestamp: 1 },
        { type: 'inbound-rtp', packetsLost: 999, packetsReceived: 1 }, // ignorado en outbound
      ],
      'outbound',
      null,
    );
    expect(metrics.lossPct).toBe(10);
    expect(metrics.rttMs).toBe(400);
    expect(metrics.jitterMs).toBe(5);
  });

  it('ignores garbage entries', () => {
    const { metrics } = summarizeStats([null, 42, 'x'], 'inbound', null);
    expect(metrics).toEqual({ lossPct: null, rttMs: null, jitterMs: null, bitrateKbps: null });
  });
});

describe('scoreConnection', () => {
  it('returns 0 (unknown) without any metric', () => {
    expect(scoreConnection({ lossPct: null, rttMs: null, jitterMs: null, bitrateKbps: null })).toBe(0);
  });

  it('takes the WORST metric', () => {
    expect(scoreConnection({ lossPct: 0, rttMs: 50, jitterMs: 5, bitrateKbps: null })).toBe(4);
    expect(scoreConnection({ lossPct: 0, rttMs: 350, jitterMs: 5, bitrateKbps: null })).toBe(2);
    expect(scoreConnection({ lossPct: 12, rttMs: 50, jitterMs: 5, bitrateKbps: null })).toBe(1);
    expect(scoreConnection({ lossPct: 2, rttMs: null, jitterMs: null, bitrateKbps: null })).toBe(3);
  });

  it('has an accessible label per level', () => {
    expect(connectionLabel(1)).toBe('Poor connection');
    expect(connectionLabel(0)).toContain('Measuring');
  });
});

describe('BandwidthGovernor', () => {
  it('enters low mode only after sustained poor quality and exits after sustained recovery', () => {
    const g = new BandwidthGovernor();
    expect(g.feed(2)).toBeNull();
    expect(g.feed(1)).toBeNull();
    expect(g.feed(4)).toBeNull(); // un pico bueno corta la racha
    expect(g.feed(2)).toBeNull();
    expect(g.feed(2)).toBeNull();
    expect(g.feed(1)).toBe('enter');
    expect(g.low).toBe(true);
    expect(g.feed(0)).toBeNull(); // desconocido no cuenta
    for (let i = 0; i < 4; i++) {
      expect(g.feed(3)).toBeNull();
    }
    expect(g.feed(4)).toBe('exit');
    expect(g.low).toBe(false);
  });

  it('reset() clears the mode', () => {
    const g = new BandwidthGovernor({ poorAtOrBelow: 2, goodAtOrAbove: 3, enterAfter: 1, exitAfter: 1 });
    expect(g.feed(1)).toBe('enter');
    g.reset();
    expect(g.low).toBe(false);
  });
});
