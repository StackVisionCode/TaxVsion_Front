import { ConnectionQuality, MediaPolicyDto, QualityThreshold } from './media-policy.model';

/**
 * F4 (T-48) — Cálculo PURO de la calidad de conexión (sin RTCPeerConnection, testeable):
 *  - `extractMetrics`: lee uno o varios `RTCStatsReport` (pc mesh o transports mediasoup) y saca RTT,
 *    pérdida y jitter por DELTA respecto al muestreo anterior, si va por TURN, kbps in/out, fps y capa.
 *  - `deriveQuality`: peor factor contra los umbrales de la política (`Excellent|Good|Fair|Poor`).
 *  - `stepQualityLevel`: histéresis — bajar es inmediato, subir exige `upgradeSamples` seguidos.
 */

export interface QualityMetrics {
  rttMs: number | null;
  lossPct: number | null;
  jitterMs: number | null;
  viaRelay: boolean;
  inKbps: number;
  outKbps: number;
  fps: number | null;
  /** Capa de simulcast que se está enviando (`rid`) o alto del frame saliente; null si no hay video. */
  layer: string | null;
  /** Paquetes recibidos en este intervalo (para detectar "sin tráfico"). */
  packetsReceivedDelta: number;
  /** Paquetes recibidos acumulados (0 = aún no llegó nada). */
  packetsReceivedTotal: number;
}

/** Contadores acumulados del muestreo anterior (los stats de WebRTC son de por vida). */
export interface StatsCounters {
  atMs: number;
  packetsLost: number;
  packetsReceived: number;
  bytesReceived: number;
  bytesSent: number;
}

type AnyStat = RTCStats & Record<string, unknown>;

/** Lee uno o varios reportes y devuelve métricas del intervalo + contadores para el siguiente. */
export function extractMetrics(
  reports: readonly RTCStatsReport[],
  previous: StatsCounters | null,
  nowMs: number,
): { metrics: QualityMetrics; counters: StatsCounters } {
  let rtt: number | null = null;
  let remoteRtt: number | null = null;
  let jitter: number | null = null;
  let viaRelay = false;
  let packetsLost = 0;
  let packetsReceived = 0;
  let bytesReceived = 0;
  let bytesSent = 0;
  let fps: number | null = null;
  let layer: string | null = null;

  for (const report of reports) {
    const byId = new Map<string, AnyStat>();
    report.forEach(stat => byId.set((stat as AnyStat).id, stat as AnyStat));
    for (const stat of byId.values()) {
      switch (stat.type) {
        case 'candidate-pair': {
          if (stat['nominated'] === true && stat['state'] === 'succeeded') {
            if (typeof stat['currentRoundTripTime'] === 'number') {
              rtt = Math.max(rtt ?? 0, stat['currentRoundTripTime'] * 1000);
            }
            const local = byId.get(String(stat['localCandidateId'] ?? ''));
            const remote = byId.get(String(stat['remoteCandidateId'] ?? ''));
            if (local?.['candidateType'] === 'relay' || remote?.['candidateType'] === 'relay') {
              viaRelay = true;
            }
          }
          break;
        }
        case 'inbound-rtp': {
          if (stat['isRemote'] === true) {
            break;
          }
          bytesReceived += num(stat['bytesReceived']);
          // Pérdida y jitter solo del AUDIO entrante: el video (simulcast, capas que cambian, frames a ráfagas)
          // da jitter y "pérdidas" aparentes que no miden la red; el audio es la señal de la calidad percibida.
          if (stat['kind'] === 'audio') {
            packetsLost += num(stat['packetsLost']);
            packetsReceived += num(stat['packetsReceived']);
            if (typeof stat['jitter'] === 'number') {
              jitter = Math.max(jitter ?? 0, stat['jitter'] * 1000);
            }
          }
          break;
        }
        case 'outbound-rtp': {
          bytesSent += num(stat['bytesSent']);
          if (stat['kind'] === 'video' && num(stat['bytesSent']) > 0) {
            if (typeof stat['framesPerSecond'] === 'number') {
              fps = Math.max(fps ?? 0, stat['framesPerSecond']);
            }
            const rid = stat['rid'];
            const height = stat['frameHeight'];
            const candidate = typeof rid === 'string' ? rid : typeof height === 'number' ? `${height}p` : null;
            if (candidate && (layer === null || candidate > layer)) {
              layer = candidate;
            }
          }
          break;
        }
        case 'remote-inbound-rtp': {
          if (typeof stat['roundTripTime'] === 'number') {
            remoteRtt = Math.max(remoteRtt ?? 0, stat['roundTripTime'] * 1000);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  const counters: StatsCounters = { atMs: nowMs, packetsLost, packetsReceived, bytesReceived, bytesSent };
  const dLost = previous ? Math.max(0, packetsLost - previous.packetsLost) : 0;
  const dRecv = previous ? Math.max(0, packetsReceived - previous.packetsReceived) : packetsReceived;
  const elapsedS = previous ? Math.max(0.001, (nowMs - previous.atMs) / 1000) : null;
  const kbps = (deltaBytes: number) => (elapsedS ? Math.round((deltaBytes * 8) / 1000 / elapsedS) : 0);

  const metrics: QualityMetrics = {
    rttMs: rtt ?? remoteRtt,
    // Con pocos paquetes (DTX, remoto muteado, consumer recién reanudado) la proporción es ruido: no se mide.
    lossPct: previous && dLost + dRecv >= MIN_PACKETS_FOR_LOSS_ESTIMATE ? (dLost / (dLost + dRecv)) * 100 : null,
    jitterMs: jitter,
    viaRelay,
    inKbps: previous ? kbps(bytesReceived - previous.bytesReceived) : 0,
    outKbps: previous ? kbps(bytesSent - previous.bytesSent) : 0,
    fps,
    layer,
    packetsReceivedDelta: dRecv,
    packetsReceivedTotal: packetsReceived,
  };
  return { metrics, counters };
}

/** Ventana mínima de paquetes entre dos muestreos para que la pérdida sea una medida y no ruido (≈2 s de audio). */
export const MIN_PACKETS_FOR_LOSS_ESTIMATE = 100;

const RANK: Record<ConnectionQuality, number> = { Excellent: 0, Good: 1, Fair: 2, Poor: 3, Disconnected: 4 };

export function qualityRank(quality: ConnectionQuality): number {
  return RANK[quality];
}

/** Peor factor (RTT, pérdida, jitter) contra los umbrales; un factor desconocido no cuenta. */
export function deriveQuality(
  metrics: Pick<QualityMetrics, 'rttMs' | 'lossPct' | 'jitterMs'>,
  thresholds: MediaPolicyDto['quality']['thresholds'],
): ConnectionQuality {
  const levels: ConnectionQuality[] = [];
  const grade = (value: number | null, pick: (t: QualityThreshold) => number) => {
    if (value === null) {
      return;
    }
    if (value <= pick(thresholds.excellent)) {
      levels.push('Excellent');
    } else if (value <= pick(thresholds.good)) {
      levels.push('Good');
    } else if (value <= pick(thresholds.unstable)) {
      levels.push('Fair');
    } else {
      levels.push('Poor');
    }
  };
  grade(metrics.rttMs, t => t.rttMs);
  grade(metrics.lossPct, t => t.lossPct);
  grade(metrics.jitterMs, t => t.jitterMs);
  if (levels.length === 0) {
    return 'Good';
  }
  return levels.reduce((worst, level) => (RANK[level] > RANK[worst] ? level : worst));
}

export interface QualityLevelState {
  level: ConnectionQuality;
  /** Nivel mejor que está "pidiendo" subir y cuántos muestreos seguidos lleva. */
  pendingLevel: ConnectionQuality | null;
  pendingCount: number;
}

export const INITIAL_QUALITY_LEVEL: QualityLevelState = { level: 'Good', pendingLevel: null, pendingCount: 0 };

/** Histéresis: empeorar aplica en 1 muestreo; mejorar exige `upgradeSamples` seguidos al mismo nivel o mejor. */
export function stepQualityLevel(state: QualityLevelState, sample: ConnectionQuality, upgradeSamples: number): QualityLevelState {
  if (RANK[sample] >= RANK[state.level]) {
    return RANK[sample] === RANK[state.level] ? { level: state.level, pendingLevel: null, pendingCount: 0 } : { level: sample, pendingLevel: null, pendingCount: 0 };
  }
  // Mejor que el actual: se acumulan muestreos consecutivos; el nivel pedido es el PEOR de la racha.
  const pendingLevel = state.pendingLevel && RANK[state.pendingLevel] > RANK[sample] ? state.pendingLevel : sample;
  const pendingCount = state.pendingLevel ? state.pendingCount + 1 : 1;
  if (pendingCount >= Math.max(1, upgradeSamples)) {
    return { level: pendingLevel, pendingLevel: null, pendingCount: 0 };
  }
  return { level: state.level, pendingLevel, pendingCount };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
