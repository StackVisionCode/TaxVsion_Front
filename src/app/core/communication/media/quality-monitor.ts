import { signal } from '@angular/core';
import { ConnectionQuality, MediaPolicyDto } from './media-policy.model';
import {
  INITIAL_QUALITY_LEVEL,
  QualityLevelState,
  QualityMetrics,
  StatsCounters,
  deriveQuality,
  extractMetrics,
  qualityRank,
  stepQualityLevel,
} from './derive-quality';

export interface QualityMonitorOptions {
  policy: MediaPolicyDto['quality'];
  /** Reportes a muestrear: `pc.getStats()` (uno por peer en mesh) o `transport.getStats()` (mediasoup). */
  sample: () => Promise<RTCStatsReport[]>;
  /** ¿Hay enlace de media conectado? Si no, el nivel es `Disconnected`. */
  isConnected: () => boolean;
  /** Solo cuando cambia de nivel (es lo que se manda al servidor). */
  onLevelChanged?(level: ConnectionQuality, metrics: QualityMetrics | null): void;
  /** Cada muestreo con sus reportes crudos (p. ej. para el detector de eco). */
  onSample?(reports: RTCStatsReport[], metrics: QualityMetrics): void;
  /** `poorSustainedSamples` muestreos Poor/Disconnected seguidos → modo solo audio (D-40). */
  onSustainedPoor?(): void;
  /**
   * Tras degradar, cada `recoverySamples` muestreos Good/Excellent seguidos → subir una capa.
   * Devuelve true cuando ya se recuperó del todo (deja de contar hasta el próximo Poor sostenido).
   */
  onRecovered?(): boolean;
}

/** Muestreos seguidos sin recibir paquetes (con enlace "conectado") para declarar `Disconnected`. */
const NO_PACKETS_SAMPLES = 2;

/**
 * F4 (T-48) — Monitor de calidad de UNA sesión: muestrea `getStats()` cada `sampleIntervalSeconds`,
 * deriva el nivel con histéresis y expone `level`/`metrics` como signals. Avisa el nivel solo al
 * cambiar, el "Poor sostenido" y la recuperación gradual. Lo crean los orquestadores por llamada /
 * reunión y lo paran con `stop()`.
 */
export class QualityMonitor {
  /** null = midiendo (sin muestreo válido todavía): la UI muestra "Measuring…", nunca "Unknown". */
  readonly level = signal<ConnectionQuality | null>(null);
  readonly metrics = signal<QualityMetrics | null>(null);

  private timer: ReturnType<typeof setInterval> | null = null;
  private counters: StatsCounters | null = null;
  private state: QualityLevelState = INITIAL_QUALITY_LEVEL;
  private noPacketSamples = 0;
  private poorRun = 0;
  private goodRun = 0;
  private degraded = false;
  /** Se midió al menos una vez con el enlace conectado (solo entonces una caída cuenta como Disconnected). */
  private everConnected = false;
  private sampling = false;

  constructor(private readonly opts: QualityMonitorOptions) {}

  start(): void {
    if (this.timer) {
      return;
    }
    const intervalMs = Math.max(1, this.opts.policy.sampleIntervalSeconds) * 1000;
    this.timer = setInterval(() => void this.sampleOnce(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.reset();
  }

  /** Olvida contadores y rachas (p. ej. tras rearmar los enlaces) sin parar el muestreo. */
  reset(): void {
    this.counters = null;
    this.state = INITIAL_QUALITY_LEVEL;
    this.noPacketSamples = 0;
    this.poorRun = 0;
    this.goodRun = 0;
    this.degraded = false;
    this.everConnected = false;
  }

  /** Fuerza un nivel desde fuera (p. ej. ICE en `disconnected`), notificando si cambia. */
  forceLevel(level: ConnectionQuality): void {
    this.state = { level, pendingLevel: null, pendingCount: 0 };
    this.publish(level);
  }

  /** Un muestreo (también invocable a mano desde tests). */
  async sampleOnce(): Promise<void> {
    if (this.sampling) {
      return;
    }
    this.sampling = true;
    try {
      if (!this.opts.isConnected()) {
        this.counters = null;
        this.noPacketSamples = 0;
        // Antes de la primera conexión no hay nada que medir: seguimos en "Measuring…" sin contar como
        // caída (si no, el arranque del SFU disparaba el modo solo audio con la sala vacía).
        if (this.everConnected) {
          this.applySample('Disconnected', null);
        }
        return;
      }
      this.everConnected = true;
      let reports: RTCStatsReport[];
      try {
        reports = await this.opts.sample();
      } catch {
        return;
      }
      if (reports.length === 0) {
        return; // nada que medir todavía (sin peers)
      }
      const { metrics, counters } = extractMetrics(reports, this.counters, Date.now());
      const first = this.counters === null;
      this.counters = counters;
      if (first) {
        return; // los deltas necesitan dos muestreos
      }
      this.metrics.set(metrics);
      this.opts.onSample?.(reports, metrics);
      // Sin paquetes entrantes en N muestreos seguidos (habiendo recibido antes): el enlace está caído.
      this.noPacketSamples = metrics.packetsReceivedDelta === 0 && metrics.packetsReceivedTotal > 0 ? this.noPacketSamples + 1 : 0;
      const sample: ConnectionQuality =
        this.noPacketSamples >= NO_PACKETS_SAMPLES ? 'Disconnected' : deriveQuality(metrics, this.opts.policy.thresholds);
      this.applySample(sample, metrics);
    } finally {
      this.sampling = false;
    }
  }

  private applySample(sample: ConnectionQuality, metrics: QualityMetrics | null): void {
    this.state = stepQualityLevel(this.state, sample, this.opts.policy.upgradeSamples);
    this.publish(this.state.level, metrics);
    this.trackRuns(sample);
  }

  private publish(level: ConnectionQuality, metrics: QualityMetrics | null = this.metrics()): void {
    if (level !== this.level()) {
      this.level.set(level);
      this.opts.onLevelChanged?.(level, metrics);
    }
  }

  /** Rachas de Poor (→ degradar) y de Good/Excellent (→ recuperar por pasos). */
  private trackRuns(sample: ConnectionQuality): void {
    const policy = this.opts.policy;
    if (qualityRank(sample) >= qualityRank('Poor')) {
      this.goodRun = 0;
      this.poorRun += 1;
      if (!this.degraded && this.poorRun >= Math.max(1, policy.poorSustainedSamples)) {
        this.degraded = true;
        this.poorRun = 0;
        this.opts.onSustainedPoor?.();
      }
      return;
    }
    this.poorRun = 0;
    if (!this.degraded || qualityRank(sample) > qualityRank('Good')) {
      this.goodRun = 0;
      return;
    }
    this.goodRun += 1;
    if (this.goodRun >= Math.max(1, policy.recoverySamples)) {
      this.goodRun = 0;
      if (this.opts.onRecovered?.() ?? true) {
        this.degraded = false;
      }
    }
  }
}
