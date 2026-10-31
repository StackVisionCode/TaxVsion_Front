/**
 * Lógica PURA de "quién está hablando" para meetings (sin WebAudio ni DOM, testeable).
 *
 * - `stepActiveSpeaker`: decide el hablante activo a partir de los niveles de audio medidos en cada
 *   tick, con HISTÉRESIS para que el tile principal no salte entre personas con cada ruido:
 *     · un nivel cuenta como voz solo si supera `threshold`;
 *     · para CAMBIAR de hablante, el candidato debe ser el más fuerte durante `switchMs` seguidos;
 *     · si nadie habla se conserva el último hablante (no se vuelve al primero de la lista);
 *     · si el hablante actual ya no está en la sala, se libera.
 * - `isSpeakingNow`: "hablando" para el indicador visual, con cola de `holdMs` para que no parpadee.
 * - `pickMiniPlayerTiles`: arma el layout del mini-player: tile principal (hablante → fijado →
 *   primer remoto), miniaturas ordenadas (los que hablaron primero) y desborde "+N".
 * - `rmsLevel`: nivel RMS (0–1) de un buffer de `AnalyserNode.getByteTimeDomainData` (detector,
 *   medidor del lobby).
 * - `levelBars`: cuantiza un nivel RMS a las 3 barras del medidor del tile (0–3), para que el signal
 *   solo cambie cuando cambia lo que se ve.
 * - `SpeakingThrottle` (T-69): emite `meeting.speaking` como máximo `maxPerSecond` veces por segundo
 *   y, si se pasa, guarda el ÚLTIMO estado para mandarlo cuando la ventana se libere (nunca se pierde
 *   el estado final).
 *
 * Ejemplo:
 *   let state = INITIAL_SPEAKER_STATE;
 *   state = stepActiveSpeaker(state, { u1: 0.2, u2: 0.01 }, performance.now());
 *   const { main, thumbs, overflow } = pickMiniPlayerTiles(['u1', 'u2'], state.current, null, 3);
 */

export interface SpeakerOptions {
  /** Nivel RMS (0–1) a partir del cual se considera voz. */
  threshold: number;
  /** Tiempo que un candidato debe ser el más fuerte antes de quitarle el tile al actual. */
  switchMs: number;
  /** Cola del indicador "hablando" tras el último pico de voz. */
  holdMs: number;
}

export const DEFAULT_SPEAKER_OPTIONS: SpeakerOptions = { threshold: 0.04, switchMs: 450, holdMs: 700 };

export interface SpeakerState {
  /** Hablante activo (último que tomó la palabra) o null. */
  current: string | null;
  /** Quien está intentando quitarle la palabra al actual. */
  candidate: string | null;
  candidateSince: number;
  /** Último instante con voz por usuario (para el indicador y el orden de miniaturas). */
  lastVoiceAt: Readonly<Record<string, number>>;
}

export const INITIAL_SPEAKER_STATE: SpeakerState = { current: null, candidate: null, candidateSince: 0, lastVoiceAt: {} };

/** Un tick del detector. `levels` = nivel por userId de los remotos PRESENTES (ausente = salió). */
export function stepActiveSpeaker(
  state: SpeakerState,
  levels: Readonly<Record<string, number>>,
  now: number,
  options: SpeakerOptions = DEFAULT_SPEAKER_OPTIONS,
): SpeakerState {
  const present = new Set(Object.keys(levels));

  // Último instante con voz: se actualiza para los que superan el umbral y se depura a los que salieron.
  const lastVoiceAt: Record<string, number> = {};
  for (const id of present) {
    if (levels[id] >= options.threshold) {
      lastVoiceAt[id] = now;
    } else if (state.lastVoiceAt[id] !== undefined) {
      lastVoiceAt[id] = state.lastVoiceAt[id];
    }
  }

  let loudest: string | null = null;
  for (const id of present) {
    if (levels[id] >= options.threshold && (loudest === null || levels[id] > levels[loudest])) {
      loudest = id;
    }
  }

  const current = state.current && present.has(state.current) ? state.current : null;

  // Nadie habla: se conserva el último hablante (si sigue dentro) y se descarta el candidato.
  if (loudest === null) {
    return { current, candidate: null, candidateSince: 0, lastVoiceAt };
  }
  // Sin hablante previo (o el previo salió): toma la palabra de inmediato.
  if (current === null || loudest === current) {
    return { current: loudest, candidate: null, candidateSince: 0, lastVoiceAt };
  }
  // Otro es el más fuerte: debe sostenerlo `switchMs` antes de quitarle el tile al actual.
  const since = state.candidate === loudest ? state.candidateSince : now;
  if (now - since >= options.switchMs) {
    return { current: loudest, candidate: null, candidateSince: 0, lastVoiceAt };
  }
  return { current, candidate: loudest, candidateSince: since, lastVoiceAt };
}

/** ¿Habló hace menos de `holdMs`? (indicador visual, sin parpadeo entre sílabas). */
export function isSpeakingNow(
  state: SpeakerState,
  userId: string,
  now: number,
  options: SpeakerOptions = DEFAULT_SPEAKER_OPTIONS,
): boolean {
  const at = state.lastVoiceAt[userId];
  return at !== undefined && now - at <= options.holdMs;
}

/** Nivel RMS (0–1) de un buffer de tiempo de `AnalyserNode` (bytes centrados en 128). */
export function rmsLevel(buffer: Uint8Array): number {
  if (buffer.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const value of buffer) {
    const centered = (value - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / buffer.length);
}

export interface MiniPlayerTiles {
  /** userId del tile principal (null = no hay remotos: el principal es mi cámara). */
  main: string | null;
  /** Miniaturas visibles (sin el principal). */
  thumbs: string[];
  /** Cuántos remotos no caben en la tira ("+N"). */
  overflow: number;
}

/**
 * Prioridad del tile principal: hablante activo → fijado (spotlight del room) → primer remoto (orden
 * de entrada). Las miniaturas van primero las que hablaron más recientemente y luego por orden de
 * entrada; `maxThumbs` limita la tira y el resto se resume en `overflow`.
 */
export function pickMiniPlayerTiles(
  remoteIds: readonly string[],
  activeSpeakerId: string | null,
  pinnedId: string | null,
  maxThumbs: number,
  lastVoiceAt: Readonly<Record<string, number>> = {},
): MiniPlayerTiles {
  const present = new Set(remoteIds);
  const main =
    activeSpeakerId && present.has(activeSpeakerId)
      ? activeSpeakerId
      : pinnedId && present.has(pinnedId)
        ? pinnedId
        : (remoteIds[0] ?? null);

  const rest = remoteIds
    .map((id, index) => ({ id, index, at: lastVoiceAt[id] ?? -Infinity }))
    .filter(entry => entry.id !== main)
    .sort((a, b) => (b.at === a.at ? a.index - b.index : b.at - a.at))
    .map(entry => entry.id);

  // `maxThumbs` = huecos de la tira. Si no caben todos, el último hueco lo ocupa el "+N".
  const limit = Math.max(0, maxThumbs);
  const thumbs = rest.length <= limit ? rest : rest.slice(0, Math.max(0, limit - 1));
  return { main, thumbs, overflow: rest.length - thumbs.length };
}

/** Barras del medidor (0–3) a partir del nivel RMS: `threshold` enciende la primera. */
export function levelBars(level: number, threshold: number = DEFAULT_SPEAKER_OPTIONS.threshold): 0 | 1 | 2 | 3 {
  if (level < threshold) {
    return 0;
  }
  if (level < threshold * 3) {
    return 1;
  }
  return level < threshold * 6 ? 2 : 3;
}

const ONE_SECOND_MS = 1000;

/**
 * Tope de emisiones por segundo con coalescencia del último valor. `now` se inyecta para los tests.
 */
export class SpeakingThrottle {
  private sentAt: number[] = [];
  private pending: boolean | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly maxPerSecond: number,
    private readonly send: (speaking: boolean) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  push(speaking: boolean): void {
    const t = this.now();
    this.sentAt = this.sentAt.filter(at => t - at < ONE_SECOND_MS);
    if (this.sentAt.length < Math.max(1, this.maxPerSecond)) {
      this.sentAt.push(t);
      this.pending = null;
      this.send(speaking);
      return;
    }
    // Ventana llena: se recuerda SOLO el último estado y se manda cuando caduque la emisión más vieja.
    this.pending = speaking;
    if (!this.timer) {
      const wait = Math.max(0, ONE_SECOND_MS - (t - this.sentAt[0]));
      this.timer = setTimeout(() => {
        this.timer = null;
        const next = this.pending;
        this.pending = null;
        if (next !== null) {
          this.push(next);
        }
      }, wait);
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
    this.sentAt = [];
  }
}
