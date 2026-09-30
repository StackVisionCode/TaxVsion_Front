/**
 * Calidad de conexión calculada LOCALMENTE a partir de `RTCPeerConnection.getStats()` (o de
 * `getStats()` de producers/consumers de mediasoup). No se transmite a nadie: solo alimenta el
 * medidor de barras que ve el propio usuario y el modo de bajo ancho de banda.
 *
 * Todo lo de este archivo es puro (sin DOM ni WebRTC) para poder testearlo con arrays de stats.
 */

/** 0 = sin datos todavía; 1 = mala … 4 = excelente. */
export type ConnectionBars = 0 | 1 | 2 | 3 | 4;

/** Contadores acumulados de un muestreo (para calcular deltas entre dos muestras). */
export interface StatsCounters {
  /** Paquetes perdidos acumulados (inbound: packetsLost; outbound: estimado por fractionLost). */
  packetsLost: number;
  /** Paquetes recibidos (inbound) o enviados (outbound) acumulados. */
  packets: number;
  /** Bytes acumulados (recibidos o enviados) — para el bitrate. */
  bytes: number;
  /** Timestamp de la muestra (ms). */
  timestamp: number;
}

/** Métricas derivadas de una muestra (y de la anterior, para las que son deltas). */
export interface ConnectionMetrics {
  lossPct: number | null;
  rttMs: number | null;
  jitterMs: number | null;
  bitrateKbps: number | null;
}

export interface StatsSummary {
  counters: StatsCounters;
  metrics: ConnectionMetrics;
}

/** Forma mínima de una entrada de RTCStatsReport que usamos (todo opcional: depende del navegador). */
interface LooseStat {
  type?: string;
  kind?: string;
  mediaType?: string;
  timestamp?: number;
  packetsLost?: number;
  packetsReceived?: number;
  packetsSent?: number;
  bytesReceived?: number;
  bytesSent?: number;
  jitter?: number;
  roundTripTime?: number;
  fractionLost?: number;
  currentRoundTripTime?: number;
  state?: string;
  nominated?: boolean;
  selected?: boolean;
}

/**
 * Resume un RTCStatsReport en contadores + métricas.
 * - `inbound`: lo que RECIBO de un peer (su tile) → inbound-rtp (pérdida, jitter, bytes).
 * - `outbound`: lo que ENVÍO (mi tile) → outbound-rtp (bytes) + remote-inbound-rtp (lo que el otro
 *   extremo reporta: pérdida fraccional y RTT).
 * En ambos casos el RTT sale del candidate-pair seleccionado si no hay uno mejor.
 */
export function summarizeStats(
  stats: Iterable<unknown>,
  direction: 'inbound' | 'outbound',
  previous: StatsCounters | null,
): StatsSummary {
  let packetsLost = 0;
  let packets = 0;
  let bytes = 0;
  let timestamp = 0;
  let jitterSum = 0;
  let jitterCount = 0;
  let rttFromRtp: number | null = null;
  let rttFromPair: number | null = null;
  let worstFractionLost: number | null = null;

  for (const raw of stats) {
    const s = raw as LooseStat;
    if (!s || typeof s !== 'object') {
      continue;
    }
    timestamp = Math.max(timestamp, s.timestamp ?? 0);
    if (direction === 'inbound' && s.type === 'inbound-rtp') {
      packetsLost += Math.max(0, s.packetsLost ?? 0);
      packets += s.packetsReceived ?? 0;
      bytes += s.bytesReceived ?? 0;
      if (typeof s.jitter === 'number') {
        jitterSum += s.jitter;
        jitterCount++;
      }
    } else if (direction === 'outbound' && s.type === 'outbound-rtp') {
      packets += s.packetsSent ?? 0;
      bytes += s.bytesSent ?? 0;
    } else if (direction === 'outbound' && s.type === 'remote-inbound-rtp') {
      if (typeof s.roundTripTime === 'number') {
        rttFromRtp = Math.max(rttFromRtp ?? 0, s.roundTripTime);
      }
      if (typeof s.fractionLost === 'number') {
        worstFractionLost = Math.max(worstFractionLost ?? 0, s.fractionLost);
      }
      if (typeof s.jitter === 'number') {
        jitterSum += s.jitter;
        jitterCount++;
      }
    } else if (s.type === 'candidate-pair' && (s.nominated || s.selected) && s.state === 'succeeded') {
      if (typeof s.currentRoundTripTime === 'number') {
        rttFromPair = Math.max(rttFromPair ?? 0, s.currentRoundTripTime);
      }
    }
  }

  const counters: StatsCounters = { packetsLost, packets, bytes, timestamp };
  const rtt = rttFromRtp ?? rttFromPair;
  const metrics: ConnectionMetrics = {
    lossPct: null,
    rttMs: rtt === null ? null : Math.round(rtt * 1000),
    jitterMs: jitterCount ? Math.round((jitterSum / jitterCount) * 1000) : null,
    bitrateKbps: null,
  };

  if (direction === 'outbound' && worstFractionLost !== null) {
    // fractionLost ya es una fracción del último intervalo RTCP (0..1).
    metrics.lossPct = Math.round(worstFractionLost * 1000) / 10;
  }

  if (previous && timestamp > previous.timestamp) {
    const dPackets = packets - previous.packets;
    const dLost = packetsLost - previous.packetsLost;
    if (direction === 'inbound' && dPackets + dLost > 0 && dPackets >= 0 && dLost >= 0) {
      metrics.lossPct = Math.round((dLost / (dPackets + dLost)) * 1000) / 10;
    }
    const dBytes = bytes - previous.bytes;
    const dSeconds = (timestamp - previous.timestamp) / 1000;
    if (dBytes >= 0 && dSeconds > 0) {
      metrics.bitrateKbps = Math.round((dBytes * 8) / 1000 / dSeconds);
    }
  }

  return { counters, metrics };
}

/** Nivel por métrica: menor es peor. Las métricas sin dato no penalizan. */
function levelFor(value: number | null, thresholds: [number, number, number]): ConnectionBars | null {
  if (value === null || Number.isNaN(value)) {
    return null;
  }
  if (value < thresholds[0]) return 4;
  if (value < thresholds[1]) return 3;
  if (value < thresholds[2]) return 2;
  return 1;
}

/**
 * Barras de calidad = la PEOR de las métricas (pérdida, RTT, jitter). Umbrales conservadores tipo
 * Meet/Zoom: pérdida <1% / <3% / <8%, RTT <150 / <300 / <500 ms, jitter <30 / <50 / <100 ms.
 * Sin ninguna métrica → 0 (desconocido: la UI no pinta barras).
 */
export function scoreConnection(metrics: ConnectionMetrics): ConnectionBars {
  const levels = [
    levelFor(metrics.lossPct, [1, 3, 8]),
    levelFor(metrics.rttMs, [150, 300, 500]),
    levelFor(metrics.jitterMs, [30, 50, 100]),
  ].filter((l): l is ConnectionBars => l !== null);
  if (levels.length === 0) {
    return 0;
  }
  return Math.min(...levels) as ConnectionBars;
}

/** Etiqueta accesible para el medidor. */
export function connectionLabel(bars: ConnectionBars): string {
  switch (bars) {
    case 4:
      return 'Excellent connection';
    case 3:
      return 'Good connection';
    case 2:
      return 'Weak connection';
    case 1:
      return 'Poor connection';
    default:
      return 'Measuring connection…';
  }
}

/**
 * Histéresis del "modo bajo ancho de banda": entra tras `enterAfter` muestras seguidas con calidad
 * ≤ `poorAtOrBelow` y sale tras `exitAfter` muestras seguidas con calidad ≥ `goodAtOrAbove`. Las
 * muestras desconocidas (0) no cuentan para nada. Evita el parpadeo on/off ante un pico aislado.
 */
export class BandwidthGovernor {
  private poorStreak = 0;
  private goodStreak = 0;
  private _low = false;

  constructor(
    private readonly options: { poorAtOrBelow: ConnectionBars; goodAtOrAbove: ConnectionBars; enterAfter: number; exitAfter: number } = {
      poorAtOrBelow: 2,
      goodAtOrAbove: 3,
      enterAfter: 3,
      exitAfter: 5,
    },
  ) {}

  get low(): boolean {
    return this._low;
  }

  /** Alimenta una muestra; devuelve 'enter'/'exit' cuando cambia el modo, o null si no cambia. */
  feed(bars: ConnectionBars): 'enter' | 'exit' | null {
    if (bars === 0) {
      return null;
    }
    if (bars <= this.options.poorAtOrBelow) {
      this.poorStreak++;
      this.goodStreak = 0;
    } else if (bars >= this.options.goodAtOrAbove) {
      this.goodStreak++;
      this.poorStreak = 0;
    } else {
      this.poorStreak = 0;
      this.goodStreak = 0;
    }
    if (!this._low && this.poorStreak >= this.options.enterAfter) {
      this._low = true;
      this.poorStreak = 0;
      return 'enter';
    }
    if (this._low && this.goodStreak >= this.options.exitAfter) {
      this._low = false;
      this.goodStreak = 0;
      return 'exit';
    }
    return null;
  }

  reset(): void {
    this.poorStreak = 0;
    this.goodStreak = 0;
    this._low = false;
  }
}
