// Solo tipos: mediasoup-client (~700 KB) se descarga en `start()`, y este archivo mismo se importa con import().
import type { types as MsTypes } from 'mediasoup-client';
import type { MediaPolicyDto } from './media-policy.model';
import { SESSION_PRODUCER_OPTIONS } from './session-producer-options';

const BITS_PER_KBIT = 1000;

/** Pistas que publica la captura: micrófono y, si se graba video, la cámara. */
export type CaptureTrackKind = 'audio' | 'camera';

/** Parámetros del transport de envío que devuelve el servidor (`*.sfu.create_transport`). */
export interface CaptureTransportParams {
  id: string;
  iceParameters: MsTypes.IceParameters;
  iceCandidates: MsTypes.IceCandidate[];
  dtlsParameters: MsTypes.DtlsParameters;
  iceServers?: RTCIceServer[];
}

/** Señalización con ack que pone el orquestador (socket de llamadas hoy; reutilizable). */
export interface CaptureSignaling {
  createTransport(): Promise<CaptureTransportParams>;
  connectTransport(transportId: string, dtlsParameters: MsTypes.DtlsParameters): Promise<unknown>;
  produce(
    transportId: string,
    kind: MsTypes.MediaKind,
    rtpParameters: MsTypes.RtpParameters,
    source: 'camera' | 'screen',
  ): Promise<{ producerId: string }>;
}

export interface CaptureTracks {
  audio: MediaStreamTrack | null;
  camera: MediaStreamTrack | null;
}

export interface SfuCapturePublisherOptions {
  signaling: CaptureSignaling;
  /** ICE de respaldo si el transport no trae los suyos (los de la llamada). */
  iceServers?: RTCIceServer[];
  /** Bitrates/Opus de la política (sin números propios). */
  policy?: MediaPolicyDto | null;
  /** Inyectable en tests; por defecto `new Device()` de mediasoup-client cargado bajo demanda. */
  createDevice?: () => Promise<DeviceLike>;
}

/** Lo mínimo del Device que se usa (permite dobles en los tests). */
export interface DeviceLike {
  load(options: { routerRtpCapabilities: MsTypes.RtpCapabilities }): Promise<void>;
  createSendTransport(options: MsTypes.TransportOptions): MsTypes.Transport;
}

/**
 * F7 (D-56) — Publicador SFU de SOLO ENVÍO, reutilizable: un Device, un send transport y un producer
 * por pista (micrófono y cámara). Lo usa la llamada 1:1 grabada para que el recorder capture del SFU
 * mientras la llamada sigue mesh. No consume nada ni toca la llamada.
 *
 * - `start(caps, tracks)`: carga el Device, crea el transport (connect/produce por señalización) y
 *   produce las pistas no nulas. Devuelve false si algo falla (queda cerrado).
 * - `setTrack(kind, track)`: sigue los cambios locales: replaceTrack + resume; null = pausa; si la
 *   cámara no tenía producer y ahora hay pista, la produce. Las operaciones se serializan.
 * - `close()`: cierra producers y transport (idempotente).
 */
export class SfuCapturePublisher {
  private transport: MsTypes.Transport | null = null;
  private readonly producers = new Map<CaptureTrackKind, MsTypes.Producer>();
  private readonly desired = new Map<CaptureTrackKind, MediaStreamTrack | null>();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly options: SfuCapturePublisherOptions) {}

  get active(): boolean {
    return !!this.transport && !this.closed;
  }

  /** Producers vivos (para tests y diagnóstico). */
  producerKinds(): CaptureTrackKind[] {
    return [...this.producers.keys()];
  }

  async start(routerRtpCapabilities: MsTypes.RtpCapabilities, tracks: CaptureTracks): Promise<boolean> {
    this.desired.set('audio', tracks.audio);
    this.desired.set('camera', tracks.camera);
    try {
      const device = await (this.options.createDevice ?? defaultDevice)();
      await device.load({ routerRtpCapabilities });
      if (this.closed) {
        return false;
      }
      const params = await this.options.signaling.createTransport();
      if (this.closed) {
        return false;
      }
      const transport = device.createSendTransport({
        id: params.id,
        iceParameters: params.iceParameters,
        iceCandidates: params.iceCandidates,
        dtlsParameters: params.dtlsParameters,
        iceServers: params.iceServers ?? this.options.iceServers,
      });
      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        this.options.signaling.connectTransport(transport.id, dtlsParameters).then(() => callback(), errback);
      });
      transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        const source = (appData as { source?: 'camera' | 'screen' }).source ?? 'camera';
        this.options.signaling
          .produce(transport.id, kind, rtpParameters, source)
          .then(({ producerId }) => callback({ id: producerId }), errback);
      });
      this.transport = transport;
      // Producción inicial fuera del `enqueue` (que traga errores): si falla, `start` devuelve false.
      const initial = (async () => {
        await this.apply('audio');
        await this.apply('camera');
      })();
      this.queue = initial.catch(() => undefined);
      await initial;
      return !this.closed;
    } catch (err) {
      console.warn('[SfuCapture] start failed:', err);
      this.close();
      return false;
    }
  }

  /** Pista local nueva (o null = dejar de enviar). Sin transport todavía, queda como la deseada. */
  setTrack(kind: CaptureTrackKind, track: MediaStreamTrack | null): Promise<void> {
    this.desired.set(kind, track);
    if (!this.transport || this.closed) {
      return Promise.resolve();
    }
    return this.enqueue(() => this.apply(kind));
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const producer of this.producers.values()) {
      try {
        producer.close();
      } catch {
        /* ya cerrado */
      }
    }
    this.producers.clear();
    try {
      this.transport?.close();
    } catch {
      /* ya cerrado */
    }
    this.transport = null;
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch(err => console.warn('[SfuCapture] track update failed:', err));
    return this.queue;
  }

  /** Lleva el producer de `kind` a la pista deseada. */
  private async apply(kind: CaptureTrackKind): Promise<void> {
    const transport = this.transport;
    if (!transport || this.closed) {
      return;
    }
    const track = this.desired.get(kind) ?? null;
    const producer = this.producers.get(kind);
    if (producer) {
      if (track) {
        if (producer.track !== track) {
          await producer.replaceTrack({ track });
        }
        if (producer.paused) {
          producer.resume();
        }
      } else if (!producer.paused) {
        producer.pause();
      }
      return;
    }
    if (!track) {
      return;
    }
    const created = await transport.produce({
      track,
      ...SESSION_PRODUCER_OPTIONS, // la pista es de la sesión local (la usa también la llamada mesh)
      appData: { source: 'camera' },
      ...this.produceOptions(kind),
    });
    if (this.closed) {
      created.close();
      return;
    }
    this.producers.set(kind, created);
  }

  private produceOptions(kind: CaptureTrackKind): Partial<MsTypes.ProducerOptions> {
    const policy = this.options.policy;
    if (!policy) {
      return {};
    }
    if (kind === 'audio') {
      return {
        codecOptions: {
          opusStereo: false,
          opusDtx: policy.audio.opusDtx,
          opusFec: policy.audio.opusFec,
          opusMaxAverageBitrate: policy.audio.maxAverageBitrateKbps * BITS_PER_KBIT,
        },
      };
    }
    // Una sola capa a la calidad alta de la cámara: el recorder graba una capa, no hace falta simulcast.
    return { encodings: [{ maxBitrate: policy.video.camera.maxBitrateKbps * BITS_PER_KBIT }] };
  }
}

async function defaultDevice(): Promise<DeviceLike> {
  const { Device } = await import('mediasoup-client');
  return new Device();
}
