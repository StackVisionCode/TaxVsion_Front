import { signal } from '@angular/core';

/**
 * RMS (0..1) de un buffer de dominio temporal de un AnalyserNode (`getByteTimeDomainData`, centrado
 * en 128). Puro para poder testearlo sin Web Audio.
 */
export function rmsFromTimeDomain(data: ArrayLike<number>): number {
  if (!data.length) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

/**
 * Detector de "está hablando" con histéresis: se activa cuando el nivel supera `onThreshold` y se
 * apaga solo tras `holdMs` por debajo de `offThreshold` — así el indicador no parpadea entre sílabas.
 */
export class SpeakingDetector {
  private speaking = false;
  private lastLoudAt = 0;

  constructor(
    private readonly onThreshold = 0.045,
    private readonly offThreshold = 0.025,
    private readonly holdMs = 450,
  ) {}

  update(level: number, now: number): boolean {
    if (level >= this.onThreshold) {
      this.speaking = true;
      this.lastLoudAt = now;
    } else if (level >= this.offThreshold && this.speaking) {
      this.lastLoudAt = now; // sigue hablando bajito
    } else if (this.speaking && now - this.lastLoudAt > this.holdMs) {
      this.speaking = false;
    }
    return this.speaking;
  }
}

interface Source {
  trackId: string;
  node: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buffer: Uint8Array<ArrayBuffer>;
  detector: SpeakingDetector;
}

/**
 * Mide el nivel de audio de varios streams (uno por participante) con un único AudioContext y un
 * AnalyserNode por pista, y publica el conjunto de claves que están hablando. Se usa para el anillo
 * "hablando" de los tiles (sobre todo con la cámara apagada). No reproduce nada: los analizadores no
 * se conectan a `destination`, el audio lo siguen reproduciendo los `<video>` de cada tile.
 *
 * Degrada en silencio donde no hay Web Audio (tests con jsdom, navegadores viejos).
 */
export class AudioLevelMonitor {
  readonly speaking = signal<ReadonlySet<string>>(new Set());

  private ctx: AudioContext | null = null;
  private readonly sources = new Map<string, Source>();
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Sincroniza las fuentes: `streams` es clave → stream (o null si esa persona no tiene audio / está
   * muteada). Crea analizadores nuevos, recrea si cambió la pista y suelta los que ya no están.
   */
  sync(streams: ReadonlyMap<string, MediaStream | null>): void {
    for (const [key, stream] of streams) {
      const track = stream?.getAudioTracks().find(t => t.readyState === 'live' && t.enabled) ?? null;
      const existing = this.sources.get(key);
      if (!track) {
        if (existing) {
          this.release(key);
        }
        continue;
      }
      if (existing && existing.trackId === track.id) {
        continue;
      }
      if (existing) {
        this.release(key);
      }
      this.attach(key, track);
    }
    for (const key of [...this.sources.keys()]) {
      if (!streams.has(key)) {
        this.release(key);
      }
    }
    if (this.sources.size > 0) {
      this.startLoop();
    } else {
      this.stopLoop();
      this.publish(new Set());
    }
  }

  dispose(): void {
    for (const key of [...this.sources.keys()]) {
      this.release(key);
    }
    this.stopLoop();
    this.publish(new Set());
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private attach(key: string, track: MediaStreamTrack): void {
    try {
      if (!this.ctx) {
        const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
        if (!Ctor) {
          return;
        }
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => undefined);
      }
      const node = this.ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      node.connect(analyser);
      this.sources.set(key, {
        trackId: track.id,
        node,
        analyser,
        buffer: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
        detector: new SpeakingDetector(),
      });
    } catch {
      /* sin Web Audio: sin indicador */
    }
  }

  private release(key: string): void {
    const src = this.sources.get(key);
    if (!src) {
      return;
    }
    try {
      src.node.disconnect();
      src.analyser.disconnect();
    } catch {
      /* ya desconectado */
    }
    this.sources.delete(key);
  }

  private startLoop(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.tick(), 120);
  }

  private stopLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const now = Date.now();
    const next = new Set<string>();
    for (const [key, src] of this.sources) {
      src.analyser.getByteTimeDomainData(src.buffer);
      if (src.detector.update(rmsFromTimeDomain(src.buffer), now)) {
        next.add(key);
      }
    }
    this.publish(next);
  }

  /** Solo publica si el conjunto cambió (evita re-render de la grilla cada 120 ms). */
  private publish(next: Set<string>): void {
    const prev = this.speaking();
    if (prev.size === next.size && [...next].every(k => prev.has(k))) {
      return;
    }
    this.speaking.set(next);
  }
}
