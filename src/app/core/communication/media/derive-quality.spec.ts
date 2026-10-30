import { describe, expect, it } from 'vitest';
import { INITIAL_QUALITY_LEVEL, deriveQuality, extractMetrics, stepQualityLevel, MIN_PACKETS_FOR_LOSS_ESTIMATE } from './derive-quality';
import { mediaPolicyFixture } from './testing/media-policy.fixture';

const thresholds = mediaPolicyFixture().quality.thresholds;

/** RTCStatsReport de mentira: un Map con `forEach(stat)` como el real. */
function report(stats: Record<string, unknown>[]): RTCStatsReport {
  const map = new Map<string, unknown>(stats.map(s => [String(s['id']), s]));
  return { forEach: (cb: (value: unknown) => void) => map.forEach(cb), get: (id: string) => map.get(id) } as unknown as RTCStatsReport;
}

describe('deriveQuality — tabla de umbrales', () => {
  it.each([
    // rtt, loss, jitter → esperado (peor factor manda)
    [100, 1, 20, 'Excellent'],
    [150, 2, 30, 'Excellent'], // bordes inclusivos
    [151, 1, 20, 'Good'],
    [300, 5, 50, 'Good'],
    [100, 6, 20, 'Fair'],
    [100, 1, 100, 'Fair'],
    [501, 1, 20, 'Poor'],
    [100, 11, 20, 'Poor'],
    [100, 1, 101, 'Poor'],
  ])('rtt=%s loss=%s jitter=%s → %s', (rttMs, lossPct, jitterMs, expected) => {
    expect(deriveQuality({ rttMs, lossPct, jitterMs }, thresholds)).toBe(expected);
  });

  it('ignora los factores desconocidos y sin ninguno devuelve Good', () => {
    expect(deriveQuality({ rttMs: null, lossPct: 8, jitterMs: null }, thresholds)).toBe('Fair');
    expect(deriveQuality({ rttMs: null, lossPct: null, jitterMs: null }, thresholds)).toBe('Good');
  });
});

describe('stepQualityLevel — histéresis', () => {
  it('bajar aplica en un muestreo', () => {
    const next = stepQualityLevel(INITIAL_QUALITY_LEVEL, 'Poor', 2);
    expect(next.level).toBe('Poor');
  });

  it('subir exige upgradeSamples seguidos y usa el PEOR nivel de la racha', () => {
    let state = stepQualityLevel(INITIAL_QUALITY_LEVEL, 'Poor', 2);
    state = stepQualityLevel(state, 'Excellent', 2);
    expect(state.level).toBe('Poor'); // 1 de 2
    state = stepQualityLevel(state, 'Good', 2);
    expect(state.level).toBe('Good'); // racha Excellent+Good → Good
  });

  it('una muestra igual al nivel actual corta la racha de subida', () => {
    let state = stepQualityLevel(INITIAL_QUALITY_LEVEL, 'Poor', 2);
    state = stepQualityLevel(state, 'Good', 2);
    state = stepQualityLevel(state, 'Poor', 2);
    state = stepQualityLevel(state, 'Good', 2);
    expect(state.level).toBe('Poor');
  });
});

describe('extractMetrics — deltas, relay y kbps', () => {
  const first = report([
    { id: 'cp', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.12, localCandidateId: 'lc', remoteCandidateId: 'rc' },
    { id: 'lc', type: 'local-candidate', candidateType: 'relay' },
    { id: 'rc', type: 'remote-candidate', candidateType: 'host' },
    { id: 'in', type: 'inbound-rtp', kind: 'audio', packetsLost: 10, packetsReceived: 1000, bytesReceived: 100_000, jitter: 0.02 },
    { id: 'out', type: 'outbound-rtp', kind: 'video', bytesSent: 50_000, framesPerSecond: 24, rid: 'r1' },
  ]);
  const second = report([
    { id: 'cp', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.2, localCandidateId: 'lc', remoteCandidateId: 'rc' },
    { id: 'lc', type: 'local-candidate', candidateType: 'relay' },
    { id: 'rc', type: 'remote-candidate', candidateType: 'host' },
    { id: 'in', type: 'inbound-rtp', kind: 'audio', packetsLost: 20, packetsReceived: 1090, bytesReceived: 200_000, jitter: 0.03 },
    { id: 'out', type: 'outbound-rtp', kind: 'video', bytesSent: 150_000, framesPerSecond: 24, rid: 'r1' },
  ]);

  it('el primer muestreo no tiene pérdida (sin delta) y el segundo la calcula sobre el intervalo', () => {
    const a = extractMetrics([first], null, 0);
    expect(a.metrics.lossPct).toBeNull();
    expect(a.metrics.rttMs).toBe(120);
    expect(a.metrics.viaRelay).toBe(true);

    const b = extractMetrics([second], a.counters, 2000);
    expect(b.metrics.lossPct).toBe(10); // 10 perdidos de 100 nuevos
    expect(b.metrics.jitterMs).toBe(30);
    expect(b.metrics.inKbps).toBe(400); // 100 kB en 2 s
    expect(b.metrics.outKbps).toBe(400);
    expect(b.metrics.fps).toBe(24);
    expect(b.metrics.layer).toBe('r1');
    expect(b.metrics.packetsReceivedDelta).toBe(90);
  });
});

describe('extractMetrics loss window', () => {
  function inbound(packetsReceived: number, packetsLost: number): RTCStatsReport {
    const stats = [{ id: 'in', type: 'inbound-rtp', kind: 'audio', packetsReceived, packetsLost, bytesReceived: packetsReceived * 100, jitter: 0.001 }];
    return { forEach: (cb: (s: unknown) => void) => stats.forEach(cb) } as unknown as RTCStatsReport;
  }

  it('does not estimate loss from a tiny packet window (DTX / muted remote) and does once the window is big enough', () => {
    const first = extractMetrics([inbound(10, 0)], null, 1000);
    const tiny = extractMetrics([inbound(30, 10)], first.counters, 4000);
    expect(tiny.metrics.lossPct).toBeNull();
    const enough = extractMetrics([inbound(30 + MIN_PACKETS_FOR_LOSS_ESTIMATE, 20)], tiny.counters, 7000);
    expect(enough.metrics.lossPct).toBeCloseTo((10 / (10 + MIN_PACKETS_FOR_LOSS_ESTIMATE)) * 100, 3);
  });
});

describe('extractMetrics uses audio only for loss and jitter', () => {
  it('ignores video jitter and video packet loss (simulcast/bursty frames are not network quality)', () => {
    const stats = [
      { id: 'a', type: 'inbound-rtp', kind: 'audio', packetsReceived: 500, packetsLost: 0, bytesReceived: 50_000, jitter: 0.005 },
      { id: 'v', type: 'inbound-rtp', kind: 'video', packetsReceived: 5000, packetsLost: 300, bytesReceived: 5_000_000, jitter: 0.25 },
    ];
    const report = { forEach: (cb: (s: unknown) => void) => stats.forEach(cb) } as unknown as RTCStatsReport;
    const first = extractMetrics([report], null, 1000);
    const next = { forEach: (cb: (s: unknown) => void) => stats.map(s => ({ ...s, packetsReceived: s.packetsReceived + 200, packetsLost: s.packetsLost + (s.kind === 'video' ? 100 : 0) })).forEach(cb) } as unknown as RTCStatsReport;
    const second = extractMetrics([next], first.counters, 4000);
    expect(second.metrics.jitterMs).toBe(5);
    expect(second.metrics.lossPct).toBe(0);
  });
});
