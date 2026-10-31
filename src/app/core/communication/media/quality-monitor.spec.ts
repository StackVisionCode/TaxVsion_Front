import { describe, expect, it, vi } from 'vitest';
import { QualityMonitor } from './quality-monitor';
import { mediaPolicyFixture } from './testing/media-policy.fixture';

function report(rttSeconds: number, packetsReceived: number, packetsLost = 0): RTCStatsReport {
  const stats = [
    { id: 'cp', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: rttSeconds },
    { id: 'in', type: 'inbound-rtp', kind: 'audio', packetsLost, packetsReceived, bytesReceived: packetsReceived * 100, jitter: 0.01 },
  ];
  return { forEach: (cb: (s: unknown) => void) => stats.forEach(cb) } as unknown as RTCStatsReport;
}

describe('QualityMonitor', () => {
  const policy = mediaPolicyFixture().quality; // upgrade 2, poorSustained 3, recovery 3

  function build(overrides: Partial<ConstructorParameters<typeof QualityMonitor>[0]> = {}) {
    const queue: RTCStatsReport[] = [];
    const handlers = { onLevelChanged: vi.fn(), onSustainedPoor: vi.fn(), onRecovered: vi.fn(() => true) };
    const monitor = new QualityMonitor({
      policy,
      sample: async () => (queue.length ? [queue.shift()!] : []),
      isConnected: () => true,
      ...handlers,
      ...overrides,
    });
    return { monitor, queue, ...handlers };
  }

  it('antes de la primera conexión sigue midiendo (sin nivel ni Poor sostenido); después, sin enlace declara Disconnected una vez', async () => {
    let connected = false;
    const { monitor, queue, onLevelChanged, onSustainedPoor } = build({ isConnected: () => connected });
    await monitor.sampleOnce();
    await monitor.sampleOnce();
    await monitor.sampleOnce();
    await monitor.sampleOnce();
    expect(monitor.level()).toBeNull();
    expect(onLevelChanged).not.toHaveBeenCalled();
    expect(onSustainedPoor).not.toHaveBeenCalled();

    connected = true;
    queue.push(report(0.05, 100), report(0.05, 200));
    await monitor.sampleOnce();
    await monitor.sampleOnce();
    connected = false;
    await monitor.sampleOnce();
    await monitor.sampleOnce();
    expect(monitor.level()).toBe('Disconnected');
    expect(onLevelChanged).toHaveBeenCalledWith('Disconnected', null);
  });

  it('Poor sostenido dispara el modo solo audio una vez y la recuperación tras recoverySamples buenos', async () => {
    const { monitor, queue, onSustainedPoor, onRecovered } = build();
    let packets = 1000;
    const push = (rtt: number) => queue.push(report(rtt, (packets += 100)));
    push(0.1); // primer muestreo: solo contadores
    await monitor.sampleOnce();
    for (let i = 0; i < 4; i++) {
      push(0.9);
      await monitor.sampleOnce();
    }
    expect(monitor.level()).toBe('Poor');
    expect(onSustainedPoor).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 3; i++) {
      push(0.1);
      await monitor.sampleOnce();
    }
    expect(monitor.level()).toBe('Excellent'); // subió con histéresis (2 muestreos)
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it('sin paquetes entrantes en dos muestreos seguidos → Disconnected', async () => {
    const { monitor, queue } = build();
    queue.push(report(0.1, 1000), report(0.1, 1100), report(0.1, 1100), report(0.1, 1100));
    for (let i = 0; i < 4; i++) {
      await monitor.sampleOnce();
    }
    expect(monitor.level()).toBe('Disconnected');
  });
});
