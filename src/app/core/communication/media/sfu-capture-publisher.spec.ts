import { describe, expect, it, vi } from 'vitest';
import type { types as MsTypes } from 'mediasoup-client';
import { CaptureSignaling, DeviceLike, SfuCapturePublisher } from './sfu-capture-publisher';
import { mediaPolicyFixture } from './testing/media-policy.fixture';

type Listener = (...args: unknown[]) => void;

/** Producer de mentira: registra replaceTrack/pause/resume/close. */
class FakeProducer {
  paused = false;
  closed = false;
  constructor(
    public track: MediaStreamTrack,
    readonly options: Record<string, unknown>,
  ) {}
  replaceTrack = vi.fn(async ({ track }: { track: MediaStreamTrack }) => {
    this.track = track;
  });
  pause = vi.fn(() => (this.paused = true));
  resume = vi.fn(() => (this.paused = false));
  close = vi.fn(() => (this.closed = true));
}

/** Transport de mentira: `produce` dispara 'connect' (la 1ª vez) y 'produce' como mediasoup-client. */
class FakeTransport {
  readonly id = 't1';
  readonly listeners = new Map<string, Listener>();
  readonly producers: FakeProducer[] = [];
  closed = false;
  private connected = false;
  on(event: string, listener: Listener): void {
    this.listeners.set(event, listener);
  }
  async produce(options: { track: MediaStreamTrack; appData?: unknown } & Record<string, unknown>): Promise<FakeProducer> {
    if (!this.connected) {
      this.connected = true;
      await new Promise<void>((resolve, reject) => this.listeners.get('connect')!({ dtlsParameters: { role: 'client' } }, resolve, reject));
    }
    await new Promise<{ id: string }>((resolve, reject) =>
      this.listeners.get('produce')!({ kind: options.track.kind, rtpParameters: { codecs: [] }, appData: options.appData }, resolve, reject),
    );
    const producer = new FakeProducer(options.track, options);
    this.producers.push(producer);
    return producer;
  }
  close(): void {
    this.closed = true;
  }
}

function track(kind: 'audio' | 'video', id: string): MediaStreamTrack {
  return { kind, id } as unknown as MediaStreamTrack;
}

function setup(opts: { failCreate?: boolean } = {}) {
  const transport = new FakeTransport();
  const device: DeviceLike = {
    load: vi.fn(async () => undefined),
    createSendTransport: vi.fn(() => transport as unknown as MsTypes.Transport),
  };
  const signaling: CaptureSignaling = {
    createTransport: vi.fn(async () => {
      if (opts.failCreate) {
        throw new Error('Call.Recording.NotCapturing');
      }
      return { id: 't1', iceParameters: {} as MsTypes.IceParameters, iceCandidates: [], dtlsParameters: {} as MsTypes.DtlsParameters };
    }),
    connectTransport: vi.fn(async () => ({})),
    produce: vi.fn(async (_t: string, kind: MsTypes.MediaKind) => ({ producerId: `p-${kind}` })),
  };
  const publisher = new SfuCapturePublisher({
    signaling,
    iceServers: [{ urls: 'stun:x' }],
    policy: mediaPolicyFixture(),
    createDevice: async () => device,
  });
  return { publisher, transport, device, signaling };
}

const CAPS = { codecs: [] } as unknown as MsTypes.RtpCapabilities;

describe('SfuCapturePublisher (F7, D-56)', () => {
  it('start: carga el Device, crea el transport de envío y produce solo las pistas presentes', async () => {
    const { publisher, transport, device, signaling } = setup();
    const mic = track('audio', 'mic');

    expect(await publisher.start(CAPS, { audio: mic, camera: null })).toBe(true);

    expect(device.load).toHaveBeenCalledWith({ routerRtpCapabilities: CAPS });
    expect(device.createSendTransport).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', iceServers: [{ urls: 'stun:x' }] }));
    expect(signaling.connectTransport).toHaveBeenCalledWith('t1', { role: 'client' });
    expect(signaling.produce).toHaveBeenCalledWith('t1', 'audio', { codecs: [] }, 'camera');
    expect(publisher.producerKinds()).toEqual(['audio']);
    // La pista es de la sesión local (la usa la llamada mesh): no se detiene al cerrar el producer.
    expect(transport.producers[0].options['stopTracks']).toBe(false);
    expect(transport.producers[0].options['codecOptions']).toEqual(expect.objectContaining({ opusStereo: false }));
  });

  it('sigue los cambios locales: replaceTrack del micro, pausa con null, reanuda y produce la cámara al encenderse', async () => {
    const { publisher, transport } = setup();
    await publisher.start(CAPS, { audio: track('audio', 'mic'), camera: null });
    const audio = transport.producers[0];

    const newMic = track('audio', 'mic-2');
    await publisher.setTrack('audio', newMic);
    expect(audio.replaceTrack).toHaveBeenCalledWith({ track: newMic });

    await publisher.setTrack('audio', null);
    expect(audio.pause).toHaveBeenCalled();
    await publisher.setTrack('audio', newMic);
    expect(audio.resume).toHaveBeenCalled();

    const cam = track('video', 'cam');
    await publisher.setTrack('camera', cam);
    expect(publisher.producerKinds()).toEqual(['audio', 'camera']);
    expect(transport.producers[1].options['encodings']).toEqual([{ maxBitrate: 1_250_000 }]);

    // Cámara apagada → se pausa el producer (no se cierra).
    await publisher.setTrack('camera', null);
    expect(transport.producers[1].pause).toHaveBeenCalled();
  });

  it('close: cierra producers y transport y deja de seguir pistas', async () => {
    const { publisher, transport } = setup();
    await publisher.start(CAPS, { audio: track('audio', 'mic'), camera: track('video', 'cam') });
    publisher.close();

    expect(transport.closed).toBe(true);
    expect(transport.producers.every(p => p.closed)).toBe(true);
    expect(publisher.active).toBe(false);
    await publisher.setTrack('camera', track('video', 'cam-2'));
    expect(transport.producers).toHaveLength(2);
    publisher.close(); // idempotente
  });

  it('si el servidor rechaza el transport, start devuelve false y queda cerrado', async () => {
    const { publisher, signaling } = setup({ failCreate: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await publisher.start(CAPS, { audio: track('audio', 'mic'), camera: null })).toBe(false);
    expect(signaling.produce).not.toHaveBeenCalled();
    expect(publisher.active).toBe(false);
    warn.mockRestore();
  });

  it('cerrado durante el arranque no produce nada', async () => {
    const { publisher, signaling } = setup();
    const started = publisher.start(CAPS, { audio: track('audio', 'mic'), camera: null });
    publisher.close();
    expect(await started).toBe(false);
    expect(signaling.produce).not.toHaveBeenCalled();
  });
});
