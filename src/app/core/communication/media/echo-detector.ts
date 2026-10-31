import { signal } from '@angular/core';

/**
 * F4 (T-68) — Detección de eco probable del lado local, a partir de `getStats()`:
 *  - `media-source` (audio): `echoReturnLossEnhancement` (ERLE, dB: cuánto eco quita el AEC; bajo y
 *    sostenido mientras hay audio remoto = el AEC no da abasto) y `audioLevel` (lo que entra por el micro).
 *  - `inbound-rtp` (audio): `audioLevel` del remoto.
 * "Eco probable" = en una ventana reciente, el nivel local SIGUE al remoto (ambos activos a la vez en
 * la mayoría de muestreos) y el ERLE —si el navegador lo expone— es bajo. Pura y testeable (`detectEcho`);
 * `EchoDetector` acumula muestreos y expone `echoSuspected`.
 */
export interface EchoSample {
  /** dB; null si el navegador no lo informa. */
  erle: number | null;
  /** 0–1 (linear) del micrófono. */
  localLevel: number;
  /** 0–1 (linear) del audio remoto que se reproduce. */
  remoteLevel: number;
}

export interface EchoDetectOptions {
  /** Muestreos a considerar. */
  windowSize: number;
  /** ERLE por debajo del cual el AEC "no está limpiando" (dB). */
  erleLowDb: number;
  /** Nivel (0–1) a partir del cual hay audio. */
  activeLevel: number;
  /** Fracción de muestreos con remoto activo en los que el local también lo está. */
  followRatio: number;
}

/** Defaults técnicos del cliente (no son reglas de negocio). */
export const DEFAULT_ECHO_OPTIONS: EchoDetectOptions = { windowSize: 5, erleLowDb: 6, activeLevel: 0.02, followRatio: 0.8 };

/** true si la ventana reciente apunta a eco. Sin muestreos con remoto activo no hay veredicto. */
export function detectEcho(samples: readonly EchoSample[], opts: EchoDetectOptions = DEFAULT_ECHO_OPTIONS): boolean {
  const window = samples.slice(-opts.windowSize);
  if (window.length < opts.windowSize) {
    return false;
  }
  const remoteActive = window.filter(s => s.remoteLevel >= opts.activeLevel);
  if (remoteActive.length < Math.ceil(opts.windowSize / 2)) {
    return false; // nadie habla del otro lado: no puede haber eco
  }
  const following = remoteActive.filter(s => s.localLevel >= opts.activeLevel).length;
  if (following / remoteActive.length < opts.followRatio) {
    return false;
  }
  const erles = window.map(s => s.erle).filter((v): v is number => v !== null);
  if (erles.length === 0) {
    return true; // sin ERLE solo queda la correlación
  }
  const avgErle = erles.reduce((a, b) => a + b, 0) / erles.length;
  return avgErle < opts.erleLowDb;
}

/** Saca el `EchoSample` de un conjunto de reportes (varios pcs/transports → se toma el máximo). */
export function echoSampleFrom(reports: readonly RTCStatsReport[]): EchoSample {
  let erle: number | null = null;
  let localLevel = 0;
  let remoteLevel = 0;
  for (const report of reports) {
    report.forEach(raw => {
      const stat = raw as RTCStats & Record<string, unknown>;
      if (stat.type === 'media-source' && stat['kind'] === 'audio') {
        if (typeof stat['echoReturnLossEnhancement'] === 'number') {
          erle = erle === null ? stat['echoReturnLossEnhancement'] : Math.min(erle, stat['echoReturnLossEnhancement']);
        }
        if (typeof stat['audioLevel'] === 'number') {
          localLevel = Math.max(localLevel, stat['audioLevel']);
        }
      } else if (stat.type === 'inbound-rtp' && stat['kind'] === 'audio' && typeof stat['audioLevel'] === 'number') {
        remoteLevel = Math.max(remoteLevel, stat['audioLevel']);
      }
    });
  }
  return { erle, localLevel, remoteLevel };
}

export class EchoDetector {
  readonly echoSuspected = signal(false);
  private samples: EchoSample[] = [];

  constructor(
    private readonly opts: EchoDetectOptions = DEFAULT_ECHO_OPTIONS,
    /** Se avisa UNA vez por episodio (al pasar de no-eco a eco). */
    private readonly onEchoSuspected?: () => void,
  ) {}

  push(reports: readonly RTCStatsReport[]): void {
    this.pushSample(echoSampleFrom(reports));
  }

  pushSample(sample: EchoSample): void {
    this.samples = [...this.samples.slice(-(this.opts.windowSize * 2)), sample];
    const suspected = detectEcho(this.samples, this.opts);
    if (suspected !== this.echoSuspected()) {
      this.echoSuspected.set(suspected);
      if (suspected) {
        this.onEchoSuspected?.();
      }
    }
  }

  reset(): void {
    this.samples = [];
    this.echoSuspected.set(false);
  }
}
